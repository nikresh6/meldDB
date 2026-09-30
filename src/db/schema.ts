import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    ...timestamps,
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (table) => [uniqueIndex("sessions_token_unique").on(table.token), index("sessions_user_id_idx").on(table.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("accounts_provider_account_unique").on(table.providerId, table.accountId),
    index("accounts_user_id_idx").on(table.userId),
  ],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

export const workspaceRole = pgEnum("workspace_role", ["owner", "admin", "developer", "viewer"]);
export const projectRole = pgEnum("project_role", ["owner", "admin", "developer", "viewer"]);
export const providerId = pgEnum("provider_id", ["supabase", "neon", "cloudflare-d1"]);
export const providerState = pgEnum("provider_state", [
  "not_connected",
  "authorizing",
  "connected",
  "provisioning",
  "healthy",
  "quota_full",
  "degraded",
  "credentials_expired",
  "revoked",
  "error",
  "disconnected",
]);
export const provisioningState = pgEnum("provisioning_state", ["pending", "running", "succeeded", "failed"]);
export const shardState = pgEnum("shard_state", ["allocating", "active", "read_only", "degraded", "offline"]);
export const queryStatus = pgEnum("query_status", ["success", "error", "cancelled"]);
export const auditOutcome = pgEnum("audit_outcome", ["success", "failure"]);

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    slug: varchar("slug", { length: 80 }).notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("workspaces_slug_unique").on(table.slug)],
);

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: workspaceRole("role").default("owner").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index("workspace_members_user_idx").on(table.userId),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    slug: varchar("slug", { length: 80 }).notNull(),
    description: text("description"),
    regionPreference: varchar("region_preference", { length: 64 }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("projects_workspace_slug_unique").on(table.workspaceId, table.slug),
    index("projects_workspace_idx").on(table.workspaceId),
  ],
);

export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: projectRole("role").default("owner").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.userId] }), index("project_members_user_idx").on(table.userId)],
);

export const providerConnections = pgTable(
  "provider_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: providerId("provider").notNull(),
    externalAccountId: varchar("external_account_id", { length: 255 }),
    externalAccountName: varchar("external_account_name", { length: 255 }),
    state: providerState("state").default("not_connected").notNull(),
    grantedScopes: text("granted_scopes").array().default(sql`ARRAY[]::text[]`).notNull(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastErrorCode: varchar("last_error_code", { length: 80 }),
    lastErrorMessage: text("last_error_message"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("provider_connections_workspace_provider_account_unique").on(
      table.workspaceId,
      table.provider,
      table.externalAccountId,
    ),
    index("provider_connections_workspace_idx").on(table.workspaceId),
  ],
);

export const credentialRecords = pgTable(
  "credential_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => providerConnections.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 80 }).notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    algorithm: varchar("algorithm", { length: 32 }).default("aes-256-gcm").notNull(),
    keyVersion: integer("key_version").default(1).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("credential_records_connection_idx").on(table.connectionId)],
);

export const providerResources = pgTable(
  "provider_resources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => providerConnections.id, { onDelete: "restrict" }),
    provider: providerId("provider").notNull(),
    externalId: varchar("external_id", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    resourceType: varchar("resource_type", { length: 32 }).notNull(),
    dialect: varchar("dialect", { length: 32 }).notNull(),
    region: varchar("region", { length: 80 }),
    state: providerState("state").default("connected").notNull(),
    consoleUrl: text("console_url"),
    storageUsedBytes: bigint("storage_used_bytes", { mode: "number" }),
    storageLimitBytes: bigint("storage_limit_bytes", { mode: "number" }),
    latencyMs: integer("latency_ms"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastErrorCode: varchar("last_error_code", { length: 80 }),
    lastErrorMessage: text("last_error_message"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("provider_resources_provider_external_unique").on(table.provider, table.externalId),
    index("provider_resources_project_idx").on(table.projectId),
    index("provider_resources_connection_idx").on(table.connectionId),
  ],
);

export const providerCapacitySnapshots = pgTable(
  "provider_capacity_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => providerConnections.id, { onDelete: "cascade" }),
    provider: providerId("provider").notNull(),
    plan: varchar("plan", { length: 80 }),
    resourceLimit: integer("resource_limit"),
    resourcesUsed: integer("resources_used"),
    resourcesRemaining: integer("resources_remaining"),
    storagePerResourceBytes: bigint("storage_per_resource_bytes", { mode: "number" }),
    accountStorageLimitBytes: bigint("account_storage_limit_bytes", { mode: "number" }),
    accountStorageUsedBytes: bigint("account_storage_used_bytes", { mode: "number" }),
    source: varchar("source", { length: 32 }).notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("capacity_connection_checked_idx").on(table.connectionId, table.checkedAt)],
);

export const provisioningOperations = pgTable(
  "provisioning_operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => providerConnections.id, { onDelete: "cascade" }),
    provider: providerId("provider").notNull(),
    action: varchar("action", { length: 48 }).notNull(),
    requestedName: varchar("requested_name", { length: 255 }),
    state: provisioningState("state").default("pending").notNull(),
    externalResourceId: varchar("external_resource_id", { length: 255 }),
    completedSteps: text("completed_steps").array().default(sql`ARRAY[]::text[]`).notNull(),
    errorCode: varchar("error_code", { length: 80 }),
    errorMessage: text("error_message"),
    ...timestamps,
  },
  (table) => [index("provisioning_operations_project_created_idx").on(table.projectId, table.createdAt)],
);

export const logicalTables = pgTable(
  "logical_tables",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    schemaName: varchar("schema_name", { length: 80 }).default("public").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    primaryKeyColumn: varchar("primary_key_column", { length: 120 }),
    routingStrategy: varchar("routing_strategy", { length: 32 }).default("hash_primary_key").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("logical_tables_project_schema_name_unique").on(table.projectId, table.schemaName, table.name),
    index("logical_tables_project_idx").on(table.projectId),
  ],
);

export const logicalColumns = pgTable(
  "logical_columns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tableId: uuid("table_id")
      .notNull()
      .references(() => logicalTables.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    canonicalType: varchar("canonical_type", { length: 80 }).notNull(),
    nullable: boolean("nullable").default(true).notNull(),
    primaryKey: boolean("primary_key").default(false).notNull(),
    defaultExpression: text("default_expression"),
    ordinal: integer("ordinal").notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("logical_columns_table_name_unique").on(table.tableId, table.name), index("logical_columns_table_idx").on(table.tableId)],
);

export const logicalIndexes = pgTable(
  "logical_indexes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tableId: uuid("table_id")
      .notNull()
      .references(() => logicalTables.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    columns: text("columns").array().notNull(),
    unique: boolean("unique").default(false).notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("logical_indexes_table_name_unique").on(table.tableId, table.name)],
);

export const physicalShards = pgTable(
  "physical_shards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    logicalTableId: uuid("logical_table_id")
      .notNull()
      .references(() => logicalTables.id, { onDelete: "cascade" }),
    shardNumber: integer("shard_number").notNull(),
    state: shardState("state").default("allocating").notNull(),
    lowerHash: text("lower_hash"),
    upperHash: text("upper_hash"),
    ...timestamps,
  },
  (table) => [uniqueIndex("physical_shards_table_number_unique").on(table.logicalTableId, table.shardNumber)],
);

export const shardPlacements = pgTable(
  "shard_placements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shardId: uuid("shard_id")
      .notNull()
      .references(() => physicalShards.id, { onDelete: "cascade" }),
    providerResourceId: uuid("provider_resource_id")
      .notNull()
      .references(() => providerResources.id, { onDelete: "restrict" }),
    physicalSchema: varchar("physical_schema", { length: 120 }),
    physicalTable: varchar("physical_table", { length: 120 }).notNull(),
    isPrimary: boolean("is_primary").default(true).notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("shard_placements_shard_resource_unique").on(table.shardId, table.providerResourceId)],
);

export const routingRules = pgTable(
  "routing_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    logicalTableId: uuid("logical_table_id")
      .notNull()
      .references(() => logicalTables.id, { onDelete: "cascade" }),
    algorithm: varchar("algorithm", { length: 48 }).default("sha256_u64_mod_v1").notNull(),
    routingColumn: varchar("routing_column", { length: 120 }).notNull(),
    version: integer("version").default(1).notNull(),
    active: boolean("active").default(true).notNull(),
    ...timestamps,
  },
  (table) => [index("routing_rules_table_active_idx").on(table.logicalTableId, table.active)],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    prefix: varchar("prefix", { length: 32 }).notNull(),
    secretHash: text("secret_hash").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("api_keys_hash_unique").on(table.secretHash), index("api_keys_project_idx").on(table.projectId)],
);

export const savedQueries = pgTable(
  "saved_queries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 160 }).notNull(),
    sql: text("sql").notNull(),
    target: varchar("target", { length: 255 }).default("unified").notNull(),
    ...timestamps,
  },
  (table) => [index("saved_queries_project_user_idx").on(table.projectId, table.userId)],
);

export const usageHourly = pgTable(
  "usage_hourly",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    bucket: timestamp("bucket", { withTimezone: true }).notNull(),
    operation: varchar("operation", { length: 48 }).notNull(),
    requestCount: integer("request_count").default(0).notNull(),
    errorCount: integer("error_count").default(0).notNull(),
    totalLatencyMs: bigint("total_latency_ms", { mode: "number" }).default(0).notNull(),
    bytesRead: bigint("bytes_read", { mode: "number" }).default(0).notNull(),
    bytesWritten: bigint("bytes_written", { mode: "number" }).default(0).notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.bucket, table.operation] })],
);

export const usageDaily = pgTable(
  "usage_daily",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    bucket: timestamp("bucket", { withTimezone: true }).notNull(),
    operation: varchar("operation", { length: 48 }).notNull(),
    requestCount: integer("request_count").default(0).notNull(),
    errorCount: integer("error_count").default(0).notNull(),
    totalLatencyMs: bigint("total_latency_ms", { mode: "number" }).default(0).notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.bucket, table.operation] })],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorApiKeyId: uuid("actor_api_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
    action: varchar("action", { length: 120 }).notNull(),
    targetType: varchar("target_type", { length: 80 }),
    targetId: text("target_id"),
    outcome: auditOutcome("outcome").notNull(),
    requestId: varchar("request_id", { length: 80 }).notNull(),
    ipHash: text("ip_hash"),
    safeMetadata: jsonb("safe_metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("audit_events_project_created_idx").on(table.projectId, table.createdAt),
    index("audit_events_workspace_created_idx").on(table.workspaceId, table.createdAt),
  ],
);

export const recentQueryLogs = pgTable(
  "recent_query_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    apiKeyId: uuid("api_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
    providerResourceId: uuid("provider_resource_id").references(() => providerResources.id, { onDelete: "set null" }),
    requestId: varchar("request_id", { length: 80 }).notNull(),
    operation: varchar("operation", { length: 48 }).notNull(),
    target: varchar("target", { length: 255 }).notNull(),
    status: queryStatus("status").notNull(),
    statementFingerprint: text("statement_fingerprint"),
    durationMs: integer("duration_ms"),
    rowCount: integer("row_count"),
    errorCode: varchar("error_code", { length: 80 }),
    errorMessage: text("error_message"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("recent_query_logs_project_created_idx").on(table.projectId, table.createdAt), index("recent_query_logs_expiry_idx").on(table.expiresAt)],
);

export const oauthStates = pgTable(
  "oauth_states",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: providerId("provider").notNull(),
    stateHash: text("state_hash").notNull(),
    codeVerifierCiphertext: text("code_verifier_ciphertext").notNull(),
    codeVerifierIv: text("code_verifier_iv").notNull(),
    codeVerifierAuthTag: text("code_verifier_auth_tag").notNull(),
    redirectPath: text("redirect_path").default("/app").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("oauth_states_hash_unique").on(table.stateHash), index("oauth_states_expiry_idx").on(table.expiresAt)],
);

export const functionMetadataCache = pgTable(
  "function_metadata_cache",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerResourceId: uuid("provider_resource_id")
      .notNull()
      .references(() => providerResources.id, { onDelete: "cascade" }),
    externalId: varchar("external_id", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    status: varchar("status", { length: 64 }),
    version: varchar("version", { length: 64 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("function_cache_resource_external_unique").on(table.providerResourceId, table.externalId)],
);

export const authConfigCache = pgTable(
  "auth_config_cache",
  {
    providerResourceId: uuid("provider_resource_id")
      .primaryKey()
      .references(() => providerResources.id, { onDelete: "cascade" }),
    safeConfig: jsonb("safe_config").$type<Record<string, unknown>>().default({}).notNull(),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true }).defaultNow().notNull(),
  },
);

export const userPreferences = pgTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  theme: varchar("theme", { length: 16 }).default("dark").notNull(),
  sidebarWidth: integer("sidebar_width").default(248).notNull(),
  commandHints: boolean("command_hints").default(true).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const onboardingStates = pgTable("onboarding_states", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  step: varchar("step", { length: 64 }).default("create_project").notNull(),
  completed: boolean("completed").default(false).notNull(),
  dismissedProviderIds: text("dismissed_provider_ids").array().default(sql`ARRAY[]::text[]`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const projectsRelations = relations(projects, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [projects.workspaceId], references: [workspaces.id] }),
  members: many(projectMembers),
  resources: many(providerResources),
  tables: many(logicalTables),
}));

export const logicalTablesRelations = relations(logicalTables, ({ one, many }) => ({
  project: one(projects, { fields: [logicalTables.projectId], references: [projects.id] }),
  columns: many(logicalColumns),
  shards: many(physicalShards),
}));

export const schema = {
  users,
  sessions,
  accounts,
  verifications,
  workspaces,
  workspaceMembers,
  projects,
  projectMembers,
  providerConnections,
  credentialRecords,
  providerResources,
  providerCapacitySnapshots,
  provisioningOperations,
  logicalTables,
  logicalColumns,
  logicalIndexes,
  physicalShards,
  shardPlacements,
  routingRules,
  apiKeys,
  savedQueries,
  usageHourly,
  usageDaily,
  auditEvents,
  recentQueryLogs,
  oauthStates,
  functionMetadataCache,
  authConfigCache,
  userPreferences,
  onboardingStates,
};
