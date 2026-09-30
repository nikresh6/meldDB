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
    apiKey: string,
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
    const tables = await this.listTables();
    return Promise.all(tables.map((table) => this.describeTable(externalId, table.name, table.schema ?? undefined)));
  }

  async listTables(): Promise<TableSummary[]> {
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
      "select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = $1 and table_name = $2 order by ordinal_position",
      [schema, table],
    );
    const columns: ColumnDescription[] = result.rows.map((row) => ({
      name: stringValue(row.column_name) ?? "unknown",
      dataType: stringValue(row.data_type) ?? "text",
      nullable: row.is_nullable === "YES",
      primaryKey: false,
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

  private getDataClient(): Sql {
    if (!this.dataConnectionUri) {
      throw new MeldError({
        code: "CONFIGURATION_REQUIRED",
        provider: this.providerId,
        status: 409,
        message: "A project-scoped Neon database credential is required for data operations. Attach the project and let MeldDB provision or store that credential first.",
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
