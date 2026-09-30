export const providerIds = ["supabase", "neon", "cloudflare-d1"] as const;

export type ProviderId = (typeof providerIds)[number];

export type ProviderConnectionState =
  | "not_connected"
  | "authorizing"
  | "connected"
  | "provisioning"
  | "healthy"
  | "quota_full"
  | "degraded"
  | "credentials_expired"
  | "revoked"
  | "error"
  | "disconnected";

export type SqlDialect = "postgresql" | "sqlite";

export interface ProviderCapabilities {
  sql: boolean;
  dialect: SqlDialect;
  fullPostgres: boolean;
  sqlite: boolean;
  tableEditing: boolean;
  schemaEditing: boolean;
  authManagement: boolean;
  edgeFunctions: boolean;
  managementOAuth: boolean;
  projectApiKey: boolean;
  regions: boolean;
}

export interface ProviderCapacity {
  provider: ProviderId;
  plan: string | null;
  resourceType: "project" | "database";
  knownFreeResourceLimit: number | null;
  actualResourcesUsed: number | null;
  actualResourcesRemaining: number | null;
  storagePerResourceBytes: number | null;
  accountStorageLimitBytes: number | null;
  accountStorageUsedBytes: number | null;
  canCreateResource: boolean;
  unavailableReason?: string;
  lastCheckedAt: string;
  source: "provider_api" | "known_limit" | "unknown";
}

export interface ProviderResource {
  externalId: string;
  name: string;
  provider: ProviderId;
  type: "project" | "database";
  region: string | null;
  dialect: SqlDialect;
  state: ProviderConnectionState;
  consoleUrl: string | null;
  createdAt: string | null;
  metadata: Record<string, string | number | boolean | null>;
}

export interface StorageUsage {
  usedBytes: number | null;
  limitBytes: number | null;
  checkedAt: string;
}

export interface TableSummary {
  schema: string | null;
  name: string;
  rowCount: number | null;
}

export interface ColumnDescription {
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue: string | null;
}

export interface TableDescription extends TableSummary {
  columns: ColumnDescription[];
}

export type QueryPrimitive = string | number | boolean | null;

export interface QueryRequest {
  sql: string;
  params: QueryPrimitive[];
  resourceId: string;
}

export interface QueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  durationMs: number | null;
  rowsRead: number | null;
  rowsWritten: number | null;
}

export interface HealthCheck {
  state: Extract<ProviderConnectionState, "healthy" | "degraded" | "credentials_expired" | "revoked" | "error">;
  latencyMs: number | null;
  checkedAt: string;
  message: string;
  requestId?: string;
}

export interface CreateResourceInput {
  name: string;
  region?: string;
  organizationId?: string;
  databasePassword?: string;
}

export interface DatabaseProviderAdapter {
  readonly providerId: ProviderId;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;
  validateConnection(): Promise<HealthCheck>;
  listResources(): Promise<ProviderResource[]>;
  getAccountCapacity(): Promise<ProviderCapacity>;
  createResource(input: CreateResourceInput): Promise<ProviderResource>;
  attachResource(externalId: string): Promise<ProviderResource>;
  disconnectResource(externalId: string): Promise<void>;
  getStorageUsage(externalId: string): Promise<StorageUsage>;
  getSchema(externalId: string): Promise<TableDescription[]>;
  listTables(externalId: string): Promise<TableSummary[]>;
  describeTable(externalId: string, table: string, schema?: string): Promise<TableDescription>;
  executeRead(request: QueryRequest): Promise<QueryResult>;
  executeWrite(request: QueryRequest): Promise<QueryResult>;
  executeSql(request: QueryRequest): Promise<QueryResult>;
  createTable(externalId: string, definition: TableDescription): Promise<void>;
  alterTable(externalId: string, sql: string, params?: QueryPrimitive[]): Promise<void>;
  dropTable(externalId: string, table: string, schema?: string): Promise<void>;
  healthCheck(externalId?: string): Promise<HealthCheck>;
}
