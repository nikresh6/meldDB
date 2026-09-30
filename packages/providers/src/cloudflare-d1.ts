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

const API = "https://api.cloudflare.com/client/v4";

export function toD1Parameters(sql: string, params: QueryRequest["params"]): { sql: string; params: QueryRequest["params"] } {
  let converted = "";
  let quote: "'" | '"' | null = null;
  const ordered: QueryRequest["params"] = [];
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]!;
    if (quote) {
      converted += character;
      if (character === quote) {
        if (sql[index + 1] === quote) { converted += sql[index + 1]; index += 1; }
        else quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"') { quote = character; converted += character; continue; }
    if (character === "$" && /[0-9]/.test(sql[index + 1] ?? "")) {
      let end = index + 1;
      while (/[0-9]/.test(sql[end] ?? "")) end += 1;
      const parameterIndex = Number(sql.slice(index + 1, end)) - 1;
      if (parameterIndex < 0 || parameterIndex >= params.length) throw new Error(`SQL parameter $${parameterIndex + 1} has no matching value.`);
      converted += "?"; ordered.push(params[parameterIndex]!); index = end - 1; continue;
    }
    converted += character;
  }
  return ordered.length ? { sql: converted, params: ordered } : { sql, params };
}

export class CloudflareD1Adapter implements DatabaseProviderAdapter {
  readonly providerId = "cloudflare-d1" as const;
  readonly displayName = "Cloudflare D1";
  readonly capabilities: ProviderCapabilities = {
    sql: true,
    dialect: "sqlite",
    fullPostgres: false,
    sqlite: true,
    tableEditing: true,
    schemaEditing: true,
    authManagement: false,
    edgeFunctions: false,
    managementOAuth: true,
    projectApiKey: false,
    regions: false,
  };

  constructor(
    private readonly accessToken: string,
    private readonly accountId: string,
  ) {}

  private request<T = unknown>(path: string, init: RequestInit = {}, message = "Cloudflare rejected the request.") {
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
    const body = asRecord(await this.request(`/accounts/${encodeURIComponent(this.accountId)}/d1/database?per_page=100`));
    return asRecords(body.result).map((database) => this.normalizeDatabase(database));
  }

  async getAccountCapacity(): Promise<ProviderCapacity> {
    const resources = await this.listResources();
    const capacity = capacityFromFallback(this.providerId, resources.length);
    capacity.accountStorageUsedBytes = resources.reduce((total, resource) => {
      const value = resource.metadata.fileSize;
      return total + (typeof value === "number" ? value : 0);
    }, 0);
    return capacity;
  }

  async createResource(input: CreateResourceInput): Promise<ProviderResource> {
    const body = asRecord(
      await this.request(
        `/accounts/${encodeURIComponent(this.accountId)}/d1/database`,
        { method: "POST", body: JSON.stringify({ name: input.name, primary_location_hint: input.region }) },
        "Cloudflare could not create this D1 database. Check D1 Edit permission and account capacity.",
      ),
    );
    return this.normalizeDatabase(asRecord(body.result));
  }

  async attachResource(externalId: string): Promise<ProviderResource> {
    const body = asRecord(
      await this.request(`/accounts/${encodeURIComponent(this.accountId)}/d1/database/${encodeURIComponent(externalId)}`),
    );
    return this.normalizeDatabase(asRecord(body.result));
  }

  async disconnectResource(): Promise<void> {
    // Local-only. D1 deletion is a separate, explicit control-plane operation.
  }

  async getStorageUsage(externalId: string): Promise<StorageUsage> {
    const resource = await this.attachResource(externalId);
    return {
      usedBytes: typeof resource.metadata.fileSize === "number" ? resource.metadata.fileSize : null,
      limitBytes: capacityFromFallback(this.providerId, null).storagePerResourceBytes,
      checkedAt: new Date().toISOString(),
    };
  }

  async getSchema(externalId: string): Promise<TableDescription[]> {
    const tables = await this.listTables(externalId);
    return Promise.all(tables.map((table) => this.describeTable(externalId, table.name)));
  }

  async listTables(externalId: string): Promise<TableSummary[]> {
    const result = await this.executeRead({
      resourceId: externalId,
      sql: "SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE ? ORDER BY name",
      params: ["table", "sqlite_%"],
    });
    return result.rows.map((row) => ({ schema: "main", name: stringValue(row.name) ?? "unknown", rowCount: null }));
  }

  async describeTable(externalId: string, table: string): Promise<TableDescription> {
    const result = await this.executeRead({
      resourceId: externalId,
      sql: `PRAGMA table_info(${quoteIdentifier(table)})`,
      params: [],
    });
    const columns: ColumnDescription[] = result.rows.map((row) => ({
      name: stringValue(row.name) ?? "unknown",
      dataType: stringValue(row.type) ?? "TEXT",
      nullable: numberValue(row.notnull) !== 1,
      primaryKey: numberValue(row.pk) === 1,
      defaultValue: stringValue(row.dflt_value),
    }));
    return { schema: "main", name: table, rowCount: null, columns };
  }

  executeRead(request: QueryRequest): Promise<QueryResult> {
    return this.executeSql(request);
  }

  executeWrite(request: QueryRequest): Promise<QueryResult> {
    return this.executeSql(request);
  }

  async executeSql(request: QueryRequest): Promise<QueryResult> {
    const query = toD1Parameters(request.sql, request.params);
    const body = asRecord(
      await this.request(
        `/accounts/${encodeURIComponent(this.accountId)}/d1/database/${encodeURIComponent(request.resourceId)}/query`,
        { method: "POST", body: JSON.stringify(query) },
        "Cloudflare D1 could not execute the query.",
      ),
    );
    const first = asRecord(Array.isArray(body.result) ? body.result[0] : body.result);
    const meta = asRecord(first.meta);
    const rows = asRecords(first.results);
    return {
      rows,
      rowCount: rows.length,
      durationMs: numberValue(meta.duration),
      rowsRead: numberValue(meta.rows_read),
      rowsWritten: numberValue(meta.rows_written),
    };
  }

  async createTable(externalId: string, definition: TableDescription): Promise<void> {
    await this.executeWrite({ resourceId: externalId, sql: createTableSql(definition, "sqlite"), params: [] });
  }

  async alterTable(externalId: string, sql: string, params = []): Promise<void> {
    await this.executeWrite({ resourceId: externalId, sql, params });
  }

  async dropTable(externalId: string, table: string): Promise<void> {
    await this.executeWrite({ resourceId: externalId, sql: `DROP TABLE ${quoteIdentifier(table)}`, params: [] });
  }

  async healthCheck(externalId?: string): Promise<HealthCheck> {
    const startedAt = performance.now();
    if (externalId) await this.attachResource(externalId);
    else await this.listResources();
    return {
      state: "healthy",
      latencyMs: Math.round(performance.now() - startedAt),
      checkedAt: new Date().toISOString(),
      message: "Cloudflare D1 API is reachable.",
    };
  }

  private normalizeDatabase(database: Record<string, unknown>): ProviderResource {
    const id = stringValue(database.uuid) ?? "unknown";
    return {
      externalId: id,
      name: stringValue(database.name) ?? id,
      provider: this.providerId,
      type: "database",
      region: stringValue(database.jurisdiction) ?? "Global",
      dialect: "sqlite",
      state: "healthy",
      consoleUrl:
        id === "unknown"
          ? null
          : `https://dash.cloudflare.com/${encodeURIComponent(this.accountId)}/workers-and-pages/d1/${encodeURIComponent(id)}`,
      createdAt: stringValue(database.created_at),
      metadata: {
        fileSize: numberValue(database.file_size),
        version: stringValue(database.version),
      },
    };
  }
}
