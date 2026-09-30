import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  apiKeys,
  auditEvents,
  functionMetadataCache,
  logicalColumns,
  logicalTables,
  providerCapacitySnapshots,
  providerConnections,
  providerResources,
  projects,
  recentQueryLogs,
} from "@/db/schema";

export interface ProjectData {
  connections: Array<{
    id: string;
    provider: "supabase" | "neon" | "cloudflare-d1";
    state: string;
    accountName: string | null;
    error: string | null;
  }>;
  resources: Array<{
    id: string;
    connectionId: string;
    provider: "supabase" | "neon" | "cloudflare-d1";
    externalId: string;
    name: string;
    region: string | null;
    dialect: string;
    state: string;
    storageUsedBytes: number | null;
    storageLimitBytes: number | null;
    latencyMs: number | null;
    lastCheckedAt: string | null;
    consoleUrl: string | null;
  }>;
  capacities: Array<{
    provider: string;
    plan: string | null;
    resourceLimit: number | null;
    resourcesUsed: number | null;
    resourcesRemaining: number | null;
    storagePerResourceBytes: number | null;
    source: string;
    checkedAt: string;
  }>;
  tables: Array<{
    id: string;
    schema: string;
    name: string;
    primaryKeyColumn: string | null;
    columns: Array<{ name: string; type: string; nullable: boolean; primaryKey: boolean; ordinal: number }>;
  }>;
  apiKeys: Array<{ id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }>;
  logs: Array<{ id: string; requestId: string; operation: string; target: string; status: string; durationMs: number | null; errorMessage: string | null; createdAt: string }>;
  audits: Array<{ id: string; action: string; outcome: string; requestId: string; createdAt: string }>;
  functionCount: number;
}

const iso = (value: Date | null) => (value ? value.toISOString() : null);

export async function loadProjectData(projectId: string): Promise<ProjectData> {
  const projectRow = await db.select({ workspaceId: projects.workspaceId }).from(projects).where(eq(projects.id, projectId)).limit(1);
  const workspaceId = projectRow[0]?.workspaceId;
  const [actualConnections, resourceRows, tableRows, keyRows, logRows, auditRows] = await Promise.all([
    workspaceId ? db.select().from(providerConnections).where(eq(providerConnections.workspaceId, workspaceId)) : [],
    db.select().from(providerResources).where(eq(providerResources.projectId, projectId)).orderBy(providerResources.provider),
    db.select().from(logicalTables).where(eq(logicalTables.projectId, projectId)).orderBy(logicalTables.name),
    db.select().from(apiKeys).where(eq(apiKeys.projectId, projectId)).orderBy(desc(apiKeys.createdAt)),
    db.select().from(recentQueryLogs).where(eq(recentQueryLogs.projectId, projectId)).orderBy(desc(recentQueryLogs.createdAt)).limit(30),
    db.select().from(auditEvents).where(eq(auditEvents.projectId, projectId)).orderBy(desc(auditEvents.createdAt)).limit(20),
  ]);

  const connectionIds = actualConnections.map((connection) => connection.id);
  const tableIds = tableRows.map((table) => table.id);
  const [capacityRows, columnRows, functionRows] = await Promise.all([
    connectionIds.length
      ? db.select().from(providerCapacitySnapshots).where(inArray(providerCapacitySnapshots.connectionId, connectionIds)).orderBy(desc(providerCapacitySnapshots.checkedAt)).limit(connectionIds.length * 2)
      : [],
    tableIds.length ? db.select().from(logicalColumns).where(inArray(logicalColumns.tableId, tableIds)).orderBy(logicalColumns.ordinal) : [],
    resourceRows.length
      ? db.select({ id: functionMetadataCache.id }).from(functionMetadataCache).where(inArray(functionMetadataCache.providerResourceId, resourceRows.map((resource) => resource.id)))
      : [],
  ]);
  const latestCapacities = [...new Map(capacityRows.map((row) => [row.provider, row])).values()];

  return {
    connections: actualConnections.map((connection) => ({
      id: connection.id,
      provider: connection.provider,
      state: connection.state,
      accountName: connection.externalAccountName,
      error: connection.lastErrorMessage,
    })),
    resources: resourceRows.map((resource) => ({
      id: resource.id,
      connectionId: resource.connectionId,
      provider: resource.provider,
      externalId: resource.externalId,
      name: resource.name,
      region: resource.region,
      dialect: resource.dialect,
      state: resource.state,
      storageUsedBytes: resource.storageUsedBytes,
      storageLimitBytes: resource.storageLimitBytes,
      latencyMs: resource.latencyMs,
      lastCheckedAt: iso(resource.lastCheckedAt),
      consoleUrl: resource.consoleUrl,
    })),
    capacities: latestCapacities.map((capacity) => ({
      provider: capacity.provider,
      plan: capacity.plan,
      resourceLimit: capacity.resourceLimit,
      resourcesUsed: capacity.resourcesUsed,
      resourcesRemaining: capacity.resourcesRemaining,
      storagePerResourceBytes: capacity.storagePerResourceBytes,
      source: capacity.source,
      checkedAt: capacity.checkedAt.toISOString(),
    })),
    tables: tableRows.map((table) => ({
      id: table.id,
      schema: table.schemaName,
      name: table.name,
      primaryKeyColumn: table.primaryKeyColumn,
      columns: columnRows
        .filter((column) => column.tableId === table.id)
        .map((column) => ({ name: column.name, type: column.canonicalType, nullable: column.nullable, primaryKey: column.primaryKey, ordinal: column.ordinal })),
    })),
    apiKeys: keyRows.map((key) => ({ id: key.id, name: key.name, prefix: key.prefix, createdAt: key.createdAt.toISOString(), lastUsedAt: iso(key.lastUsedAt), revokedAt: iso(key.revokedAt) })),
    logs: logRows.map((log) => ({ id: log.id, requestId: log.requestId, operation: log.operation, target: log.target, status: log.status, durationMs: log.durationMs, errorMessage: log.errorMessage, createdAt: log.createdAt.toISOString() })),
    audits: auditRows.map((audit) => ({ id: audit.id, action: audit.action, outcome: audit.outcome, requestId: audit.requestId, createdAt: audit.createdAt.toISOString() })),
    functionCount: functionRows.length,
  };
}
