import {
  capacityFromFallback,
  type ColumnDescription,
  type CreateResourceInput,
  type DatabaseProviderAdapter,
  type HealthCheck,
  type ProviderCapabilities,
  type ProviderCapacity,
  type ProviderResource,
  type QueryRequest,
  type QueryResult,
  type StorageUsage,
  type TableDescription,
  type TableSummary,
} from "@melddb/core";
import { asRecord, asRecords, numberValue, providerFetch, quoteIdentifier, stringValue } from "./http";
import { createTableSql } from "./schema-sql";

const API = "https://api.supabase.com";

export class SupabaseAdapter implements DatabaseProviderAdapter {
  readonly providerId = "supabase" as const;
  readonly displayName = "Supabase";
  readonly capabilities: ProviderCapabilities = {
    sql: true,
    dialect: "postgresql",
    fullPostgres: true,
    sqlite: false,
    tableEditing: true,
    schemaEditing: true,
    authManagement: true,
    edgeFunctions: true,
    managementOAuth: true,
    projectApiKey: true,
    regions: true,
  };

  constructor(private readonly accessToken: string) {}

  private request<T = unknown>(path: string, init: RequestInit = {}, message = "Supabase rejected the request.") {
    return providerFetch<T>(`${API}${path}`, {
      ...init,
      provider: this.providerId,
      token: this.accessToken,
      fallbackMessage: message,
    });
  }

  async validateConnection(): Promise<HealthCheck> {
    return this.healthCheck();
  }

  async listResources(): Promise<ProviderResource[]> {
    const body = await this.request<unknown>("/v1/projects");
    return asRecords(body).map((project) => this.normalizeProject(project));
  }

  async getAccountCapacity(): Promise<ProviderCapacity> {
    const resources = await this.listResources();
    return capacityFromFallback(this.providerId, resources.filter((resource) => resource.state !== "disconnected").length);
  }

  async createResource(input: CreateResourceInput): Promise<ProviderResource> {
    const project = asRecord(
      await this.request<unknown>(
        "/v1/projects",
        {
          method: "POST",
          body: JSON.stringify({
            name: input.name,
            organization_id: input.organizationId,
            region: input.region,
            db_pass: input.databasePassword,
          }),
        },
        "Supabase could not create this project. Check organization access, region, and project capacity.",
      ),
    );
    return this.normalizeProject(project);
  }

  async attachResource(externalId: string): Promise<ProviderResource> {
    return this.normalizeProject(asRecord(await this.request(`/v1/projects/${encodeURIComponent(externalId)}`)));
  }

  async disconnectResource(): Promise<void> {
    // Disconnect is a local control-plane operation. Supabase infrastructure is deliberately untouched.
  }

  async getStorageUsage(externalId: string): Promise<StorageUsage> {
    const body = asRecord(await this.request(`/v1/projects/${encodeURIComponent(externalId)}/database/size`));
    return {
      usedBytes: numberValue(body.size) ?? numberValue(body.database_size),
      limitBytes: capacityFromFallback("supabase", null).storagePerResourceBytes,
      checkedAt: new Date().toISOString(),
    };
  }

  async getSchema(externalId: string): Promise<TableDescription[]> {
    const tables = await this.listTables(externalId);
    return Promise.all(tables.map((table) => this.describeTable(externalId, table.name, table.schema ?? undefined)));
  }

  async listTables(externalId: string): Promise<TableSummary[]> {
    const result = await this.executeRead({
      resourceId: externalId,
      sql: "select table_schema, table_name from information_schema.tables where table_type = $1 and table_schema not in ($2, $3) order by table_schema, table_name",
      params: ["BASE TABLE", "pg_catalog", "information_schema"],
    });
    return result.rows.map((row) => ({
      schema: stringValue(row.table_schema),
      name: stringValue(row.table_name) ?? "unknown",
      rowCount: null,
    }));
  }

  async describeTable(externalId: string, table: string, schema = "public"): Promise<TableDescription> {
    const result = await this.executeRead({
      resourceId: externalId,
      sql: `select
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
      params: [schema, table],
    });
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
    return this.executeSql(request);
  }

  executeWrite(request: QueryRequest): Promise<QueryResult> {
    return this.executeSql(request);
  }

  async executeSql(request: QueryRequest): Promise<QueryResult> {
    const startedAt = performance.now();
    const body = await this.request<unknown>(
      `/v1/projects/${encodeURIComponent(request.resourceId)}/database/query`,
      { method: "POST", body: JSON.stringify({ query: request.sql, parameters: request.params }) },
      "Supabase could not execute the database query.",
    );
    const record = asRecord(body);
    const rows = asRecords(record.result ?? record.rows ?? body);
    return {
      rows,
      rowCount: numberValue(record.rowCount) ?? rows.length,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      rowsRead: null,
      rowsWritten: null,
    };
  }

  async createTable(externalId: string, definition: TableDescription): Promise<void> {
    await this.executeWrite({ resourceId: externalId, sql: createTableSql(definition, "postgresql"), params: [] });
  }

  async alterTable(externalId: string, sql: string, params = []): Promise<void> {
    await this.executeWrite({ resourceId: externalId, sql, params });
  }

  async dropTable(externalId: string, table: string, schema = "public"): Promise<void> {
    await this.executeWrite({
      resourceId: externalId,
      sql: `DROP TABLE ${quoteIdentifier(schema)}.${quoteIdentifier(table)}`,
      params: [],
    });
  }

  async healthCheck(externalId?: string): Promise<HealthCheck> {
    const startedAt = performance.now();
    if (externalId) {
      await this.request(`/v1/projects/${encodeURIComponent(externalId)}/health`);
    } else {
      await this.request("/v1/projects");
    }
    return {
      state: "healthy",
      latencyMs: Math.round(performance.now() - startedAt),
      checkedAt: new Date().toISOString(),
      message: "Supabase Management API is reachable.",
    };
  }

  private normalizeProject(project: Record<string, unknown>): ProviderResource {
    const id = stringValue(project.id) ?? stringValue(project.ref) ?? "unknown";
    const status = stringValue(project.status)?.toLowerCase();
    return {
      externalId: id,
      name: stringValue(project.name) ?? id,
      provider: this.providerId,
      type: "project",
      region: stringValue(project.region),
      dialect: "postgresql",
      state: status === "active_healthy" || status === "active" ? "healthy" : status ? "degraded" : "connected",
      consoleUrl: id === "unknown" ? null : `https://supabase.com/dashboard/project/${encodeURIComponent(id)}`,
      createdAt: stringValue(project.created_at),
      metadata: { status: status ?? "unknown" },
    };
  }
}
