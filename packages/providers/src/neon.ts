import { createApiClient, type Api, type Project, type ProjectListItem } from "@neondatabase/api-client";
import postgres, { type Sql } from "postgres";
import {
  MeldError,
  capacityFromFallback,
  type CreateResourceInput,
  type DatabaseProviderAdapter,
  type HealthCheck,
  type ProviderCapabilities,
  type ProviderCapacity,
  type ProviderResource,
  type ColumnDescription,
  type QueryRequest,
  type QueryResult,
  type StorageUsage,
  type TableDescription,
  type TableSummary,
} from "@melddb/core";
import { createTableSql } from "./schema-sql";
import { quoteIdentifier, stringValue } from "./http";

type NeonClient = Pick<Api<unknown>, "listProjects" | "createProject" | "getProject">;

interface ExistingProjectAccess {
  resource: ProviderResource;
  connectionUri: string;
  branchId: string;
  databaseName: string;
  roleName: string;
}

interface NeonBranch {
  id: string;
  name?: string;
}

interface NeonDatabase {
  name: string;
  owner_name?: string;
}

interface NeonRole {
  name: string;
  protected?: boolean;
}

export class NeonAdapter implements DatabaseProviderAdapter {
  readonly providerId = "neon" as const;
  readonly displayName = "Neon";
  readonly capabilities: ProviderCapabilities = {
    sql: true,
    dialect: "postgresql",
    fullPostgres: true,
    sqlite: false,
    tableEditing: true,
    schemaEditing: true,
    authManagement: false,
    edgeFunctions: false,
    managementOAuth: false,
    projectApiKey: true,
    regions: true,
  };

  private readonly client: NeonClient;
  private queryClient?: Sql;

  constructor(
    private readonly apiKey: string,
    client?: NeonClient,
    private readonly dataConnectionUri?: string,
  ) {
    this.client = client ?? createApiClient({ apiKey });
  }

  async validateConnection(): Promise<HealthCheck> {
    return this.healthCheck();
  }

  async listResources(): Promise<ProviderResource[]> {
    const response = await this.client.listProjects({ limit: 100 });
    return response.data.projects.map((project) => this.normalizeProject(project));
  }

  async getAccountCapacity(): Promise<ProviderCapacity> {
    const projects = await this.listResources();
    return capacityFromFallback(this.providerId, projects.length);
  }

  async createResource(input: CreateResourceInput): Promise<ProviderResource> {
    return (await this.createResourceWithCredentials(input)).resource;
  }

  async createResourceWithCredentials(input: CreateResourceInput): Promise<{ resource: ProviderResource; connectionUri: string | null }> {
    const response = await this.client.createProject({
      project: {
        name: input.name,
        region_id: input.region,
        org_id: input.organizationId,
        store_passwords: true,
      },
    });
    return {
      resource: this.normalizeProject(response.data.project),
      connectionUri: response.data.connection_uris[0]?.connection_uri ?? null,
    };
  }

  async attachResource(externalId: string): Promise<ProviderResource> {
    const response = await this.client.getProject(externalId);
    return this.normalizeProject(response.data.project);
  }

  async attachResourceWithCredentials(externalId: string): Promise<ExistingProjectAccess> {
    const response = await this.client.getProject(externalId);
    const project = response.data.project as Project & {
      default_branch_id?: string;
      database_name?: string;
      database_user?: string;
    };

    const branchId = project.default_branch_id ?? await this.resolveDefaultBranchId(externalId);
    const databases = await this.managementGet<{ databases?: NeonDatabase[] }>(
      `/projects/${encodeURIComponent(externalId)}/branches/${encodeURIComponent(branchId)}/databases`,
    );
    const databaseList = Array.isArray(databases.databases) ? databases.databases : [];
    if (!databaseList.length) {
      throw new MeldError({
        code: "PROVIDER_ERROR",
        provider: this.providerId,
        status: 502,
        message: "Neon returned no databases for the project's default branch.",
      });
    }

    const databaseName =
      project.database_name && databaseList.some((database) => database.name === project.database_name)
        ? project.database_name
        : databaseList.find((database) => database.name === "neondb")?.name ?? databaseList[0]!.name;

    const database = databaseList.find((candidate) => candidate.name === databaseName) ?? databaseList[0]!;
    let roleName = project.database_user ?? database.owner_name;

    if (!roleName) {
      const roles = await this.managementGet<{ roles?: NeonRole[] }>(
        `/projects/${encodeURIComponent(externalId)}/branches/${encodeURIComponent(branchId)}/roles`,
      );
      const roleList = Array.isArray(roles.roles) ? roles.roles : [];
      roleName =
        roleList.find((role) => role.name === `${databaseName}_owner`)?.name ??
        roleList.find((role) => role.protected !== true)?.name ??
        roleList[0]?.name;
    }

    if (!roleName) {
      throw new MeldError({
        code: "PROVIDER_ERROR",
        provider: this.providerId,
        status: 502,
        message: "Neon returned no database role that MeldDB can use for this project.",
      });
    }

    const params = new URLSearchParams({
      database_name: databaseName,
      role_name: roleName,
      branch_id: branchId,
      pooled: "true",
    });
    const connection = await this.managementGet<{ uri?: string }>(
      `/projects/${encodeURIComponent(externalId)}/connection_uri?${params.toString()}`,
    );
    if (!connection.uri) {
      throw new MeldError({
        code: "PROVIDER_ERROR",
        provider: this.providerId,
        status: 502,
        message: "Neon did not return a connection URI for this project.",
      });
    }

    const resource = this.normalizeProject(project);
    return {
      resource: {
        ...resource,
        metadata: {
          ...resource.metadata,
          branchId,
          databaseName,
          roleName,
          dataAccess: true,
        },
      },
      connectionUri: connection.uri,
      branchId,
      databaseName,
      roleName,
    };
  }

  async disconnectResource(): Promise<void> {
    // Local-only by design; Neon resources remain in the customer's account.
  }

  async getStorageUsage(externalId: string): Promise<StorageUsage> {
    const response = await this.client.getProject(externalId);
    return {
      usedBytes: response.data.project.synthetic_storage_size ?? null,
      limitBytes: response.data.project.branch_logical_size_limit_bytes || capacityFromFallback("neon", null).storagePerResourceBytes,
      checkedAt: new Date().toISOString(),
    };
  }

  async getSchema(externalId: string): Promise<TableDescription[]> {
    const tables = await this.listTables(externalId);
    return Promise.all(tables.map((table) => this.describeTable(externalId, table.name, table.schema ?? undefined)));
  }

  async listTables(externalId?: string): Promise<TableSummary[]> {
    void externalId;
    const result = await this.runDataQuery(
      "select table_schema, table_name from information_schema.tables where table_type = $1 and table_schema not in ($2, $3) order by table_schema, table_name",
      ["BASE TABLE", "pg_catalog", "information_schema"],
    );
    return result.rows.map((row) => ({
      schema: stringValue(row.table_schema),
      name: stringValue(row.table_name) ?? "unknown",
      rowCount: null,
    }));
  }

  async describeTable(_externalId: string, table: string, schema = "public"): Promise<TableDescription> {
    const result = await this.runDataQuery(
      `select
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default,
        exists (
          select 1
          from information_schema.table_constraints tc
          join information_schema.key_column_usage kcu
            on tc.constraint_name = kcu.constraint_name
           and tc.constraint_schema = kcu.constraint_schema
           and tc.table_name = kcu.table_name
          where tc.constraint_type = 'PRIMARY KEY'
            and tc.table_schema = c.table_schema
            and tc.table_name = c.table_name
            and kcu.column_name = c.column_name
        ) as is_primary_key
      from information_schema.columns c
      where c.table_schema = $1 and c.table_name = $2
      order by c.ordinal_position`,
      [schema, table],
    );
    const columns: ColumnDescription[] = result.rows.map((row) => ({
      name: stringValue(row.column_name) ?? "unknown",
      dataType: stringValue(row.data_type) ?? "text",
      nullable: row.is_nullable === "YES",
      primaryKey: row.is_primary_key === true,
      defaultValue: stringValue(row.column_default),
    }));
    return { schema, name: table, rowCount: null, columns };
  }

  executeRead(request: QueryRequest): Promise<QueryResult> {
    return this.runDataQuery(request.sql, request.params);
  }

  executeWrite(request: QueryRequest): Promise<QueryResult> {
    return this.runDataQuery(request.sql, request.params);
  }

  executeSql(request: QueryRequest): Promise<QueryResult> {
    return this.runDataQuery(request.sql, request.params);
  }

  async createTable(_externalId: string, definition: TableDescription): Promise<void> {
    await this.runDataQuery(createTableSql(definition, "postgresql"), []);
  }

  async alterTable(_externalId: string, sql: string): Promise<void> {
    await this.runDataQuery(sql, []);
  }

  async dropTable(_externalId: string, table: string, schema = "public"): Promise<void> {
    await this.runDataQuery(`DROP TABLE ${quoteIdentifier(schema)}.${quoteIdentifier(table)}`, []);
  }

  async healthCheck(externalId?: string): Promise<HealthCheck> {
    const startedAt = performance.now();
    if (externalId) await this.client.getProject(externalId);
    else await this.client.listProjects({ limit: 1 });
    return {
      state: "healthy",
      latencyMs: Math.round(performance.now() - startedAt),
      checkedAt: new Date().toISOString(),
      message: "Neon API is reachable.",
    };
  }

  private normalizeProject(project: Project | ProjectListItem): ProviderResource {
    return {
      externalId: project.id,
      name: project.name,
      provider: this.providerId,
      type: "project",
      region: project.region_id,
      dialect: "postgresql",
      state: "healthy",
      consoleUrl: `https://console.neon.tech/app/projects/${encodeURIComponent(project.id)}`,
      createdAt: project.created_at,
      metadata: {
        pgVersion: project.pg_version,
        storageBytes: project.synthetic_storage_size ?? null,
      },
    };
  }

  private async resolveDefaultBranchId(projectId: string): Promise<string> {
    const response = await this.managementGet<{ branches?: NeonBranch[] }>(
      `/projects/${encodeURIComponent(projectId)}/branches`,
    );
    const branches = Array.isArray(response.branches) ? response.branches : [];
    const branch = branches.find((candidate) => candidate.name === "production") ??
      branches.find((candidate) => candidate.name === "main") ??
      branches[0];
    if (!branch?.id) {
      throw new MeldError({
        code: "PROVIDER_ERROR",
        provider: this.providerId,
        status: 502,
        message: "Neon returned no branch for this project.",
      });
    }
    return branch.id;
  }

  private async managementGet<T>(path: string): Promise<T> {
    const response = await fetch(`https://console.neon.tech/api/v2${path}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await response.json().catch(() => ({}))) as T & {
      message?: string;
      error?: { message?: string };
    };
    if (!response.ok) {
      throw new MeldError({
        code: response.status === 401 || response.status === 403 ? "CREDENTIALS_EXPIRED" : "PROVIDER_ERROR",
        provider: this.providerId,
        status: response.status === 401 || response.status === 403 ? 401 : 502,
        message: body.error?.message ?? body.message ?? "Neon rejected a management API request.",
      });
    }
    return body;
  }

  private getDataClient(): Sql {
    if (!this.dataConnectionUri) {
      throw new MeldError({
        code: "CONFIGURATION_REQUIRED",
        provider: this.providerId,
        status: 409,
        message: "A project-scoped Neon database credential is required for data operations. Sync the resource to let MeldDB retrieve and encrypt one.",
      });
    }
    this.queryClient ??= postgres(this.dataConnectionUri, { max: 2, prepare: false, connect_timeout: 10, idle_timeout: 20 });
    return this.queryClient;
  }

  private async runDataQuery(sql: string, params: QueryRequest["params"]): Promise<QueryResult> {
    const startedAt = performance.now();
    const result = await this.getDataClient().unsafe(sql, params);
    const rows = Array.from(result) as Array<Record<string, unknown>>;
    return {
      rows,
      rowCount: result.count,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      rowsRead: null,
      rowsWritten: null,
    };
  }
}
