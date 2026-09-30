import { createHash } from "node:crypto";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import {
  classifyUnifiedSql,
  MeldError,
  routeToShard,
  verifyApiKey,
  type ProviderId,
  type QueryPrimitive,
  type QueryResult,
} from "@melddb/core";
import { db } from "@/db";
import {
  apiKeys,
  logicalTables,
  physicalShards,
  providerResources,
  recentQueryLogs,
  shardPlacements,
  usageHourly,
} from "@/db/schema";
import { providerAdapterForProject } from "@/lib/provider-service";

export function assertApiKeyProject(keyProjectId: string, requestedProjectId: string): void {
  if (keyProjectId !== requestedProjectId) {
    throw new MeldError({ code: "FORBIDDEN", message: "This API key does not belong to the requested project.", status: 403 });
  }
}

export async function authenticateApiKey(secret: string, requestedProjectId: string) {
  const pepper = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!pepper) throw new MeldError({ code: "CONFIGURATION_REQUIRED", message: "API key verification is not configured.", status: 503 });
  const prefix = secret.slice(0, "mdb_live_".length + 8);
  const candidates = await db
    .select()
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.prefix, prefix),
        isNull(apiKeys.revokedAt),
        or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date())),
      ),
    );
  const key = candidates.find((candidate) => verifyApiKey(secret, candidate.secretHash, pepper));
  if (!key) throw new MeldError({ code: "AUTHENTICATION_REQUIRED", message: "The MeldDB API key is invalid or revoked.", status: 401 });
  assertApiKeyProject(key.projectId, requestedProjectId);
  return key;
}

interface ExecuteUnifiedInput {
  projectId: string;
  apiKeyId?: string;
  userId?: string;
  sql: string;
  params: QueryPrimitive[];
  routingKey?: string | number | bigint | boolean;
  confirmDestructive?: boolean;
  requestId: string;
}

export async function executeUnified(input: ExecuteUnifiedInput): Promise<QueryResult & { providers: ProviderId[] }> {
  const plan = classifyUnifiedSql(input.sql);
  if (plan.requiresConfirmation && !input.confirmDestructive) {
    throw new MeldError({ code: "INVALID_INPUT", message: "DELETE requires confirmDestructive: true.", status: 409 });
  }

  const tableRows = await db
    .select({ id: logicalTables.id })
    .from(logicalTables)
    .where(and(eq(logicalTables.projectId, input.projectId), eq(logicalTables.name, plan.table)))
    .limit(1);
  const table = tableRows[0];
  if (!table) throw new MeldError({ code: "NOT_FOUND", message: `Logical table ${plan.table} is not in this project's catalog.`, status: 404 });

  const placements = await db
    .select({
      shardId: physicalShards.id,
      shardState: physicalShards.state,
      physicalTable: shardPlacements.physicalTable,
      physicalSchema: shardPlacements.physicalSchema,
      externalId: providerResources.externalId,
      provider: providerResources.provider,
    })
    .from(physicalShards)
    .innerJoin(shardPlacements, eq(physicalShards.id, shardPlacements.shardId))
    .innerJoin(providerResources, eq(shardPlacements.providerResourceId, providerResources.id))
    .where(and(eq(physicalShards.logicalTableId, table.id), eq(physicalShards.state, "active")));
  if (placements.length === 0) throw new MeldError({ code: "PROVIDER_UNREACHABLE", message: "This table has no active physical placement.", status: 503 });

  let targets = placements;
  if (placements.length > 1 && (plan.isWrite || input.routingKey !== undefined)) {
    if (input.routingKey === undefined) {
      throw new MeldError({ code: "INVALID_INPUT", message: "A routingKey is required to write to a sharded table.", status: 400 });
    }
    const targetId = routeToShard(input.routingKey, placements.map((placement) => placement.shardId));
    targets = placements.filter((placement) => placement.shardId === targetId);
  }

  const startedAt = performance.now();
  try {
    const results = await Promise.all(
      targets.map(async (target) => {
        if (target.physicalTable !== plan.table) {
          throw new MeldError({
            code: "UNSUPPORTED_SQL",
            message: "This table uses a renamed physical placement. Query through the structured SDK until AST identifier rewriting is enabled.",
            status: 422,
          });
        }
        const { adapter } = await providerAdapterForProject(input.projectId, target.provider, target.externalId);
        const query = { resourceId: target.externalId, sql: input.sql, params: input.params };
        return plan.isWrite ? adapter.executeWrite(query) : adapter.executeRead(query);
      }),
    );
    const merged: QueryResult & { providers: ProviderId[] } = {
      rows: results.flatMap((result) => result.rows).slice(0, 1000),
      rowCount: results.reduce((total, result) => total + result.rowCount, 0),
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      rowsRead: results.some((result) => result.rowsRead === null)
        ? null
        : results.reduce((total, result) => total + (result.rowsRead ?? 0), 0),
      rowsWritten: results.some((result) => result.rowsWritten === null)
        ? null
        : results.reduce((total, result) => total + (result.rowsWritten ?? 0), 0),
      providers: [...new Set(targets.map((target) => target.provider))],
    };
    await recordUsage(input, plan.operation, "success", merged.durationMs, merged.rowCount);
    return merged;
  } catch (error) {
    await recordUsage(input, plan.operation, "error", Math.round(performance.now() - startedAt), null, error);
    throw error;
  }
}

async function recordUsage(
  input: ExecuteUnifiedInput,
  operation: string,
  status: "success" | "error",
  durationMs: number | null,
  rowCount: number | null,
  error?: unknown,
) {
  const bucket = new Date();
  bucket.setUTCMinutes(0, 0, 0);
  const retentionDays = Number(process.env.QUERY_LOG_RETENTION_DAYS ?? "7");
  const statementFingerprint = createHash("sha256").update(input.sql, "utf8").digest("base64url");
  await Promise.all([
    db
      .insert(usageHourly)
      .values({
        projectId: input.projectId,
        bucket,
        operation,
        requestCount: 1,
        errorCount: status === "error" ? 1 : 0,
        totalLatencyMs: durationMs ?? 0,
      })
      .onConflictDoUpdate({
        target: [usageHourly.projectId, usageHourly.bucket, usageHourly.operation],
        set: {
          requestCount: sql`${usageHourly.requestCount} + 1`,
          errorCount: sql`${usageHourly.errorCount} + ${status === "error" ? 1 : 0}`,
          totalLatencyMs: sql`${usageHourly.totalLatencyMs} + ${durationMs ?? 0}`,
        },
      }),
    db.insert(recentQueryLogs).values({
      projectId: input.projectId,
      apiKeyId: input.apiKeyId,
      userId: input.userId,
      requestId: input.requestId,
      operation,
      target: "unified",
      status,
      statementFingerprint,
      durationMs: durationMs === null ? null : Math.round(durationMs),
      rowCount,
      errorCode: error instanceof MeldError ? error.code : error ? "INTERNAL_ERROR" : null,
      errorMessage: error instanceof MeldError ? error.message : error ? "Query execution failed." : null,
      expiresAt: new Date(Date.now() + retentionDays * 86_400_000),
    }),
  ]);
}
