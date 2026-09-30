import { and, eq } from "drizzle-orm";
import { MeldError } from "@melddb/core";
import { Parser } from "node-sql-parser";
import { z } from "zod";
import { db } from "@/db";
import { providerResources } from "@/db/schema";
import { requireProjectAccess } from "@/lib/authorization";
import { executeUnified } from "@/lib/gateway";
import { errorResponse, requestId } from "@/lib/http";
import { providerAdapterForProject } from "@/lib/provider-service";
import { consumeRateLimit } from "@/lib/rate-limit";

const inputSchema = z.object({
  sql: z.string().min(1).max(100_000),
  params: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).max(100).default([]),
  target: z.string().default("unified"),
  routingKey: z.union([z.string(), z.number(), z.boolean()]).optional(),
  confirmDestructive: z.boolean().default(false),
});

type RouteContext = { params: Promise<{ projectId: string }> };

function physicalStatementType(sql: string, dialect: "Postgresql" | "sqlite"): string {
  const parsed = new Parser().astify(sql, { database: dialect });
  if (Array.isArray(parsed)) throw new MeldError({ code: "INVALID_INPUT", message: "Run one physical SQL statement at a time.", status: 400 });
  const type = typeof parsed === "object" && parsed && "type" in parsed ? String(parsed.type).toLowerCase() : "unknown";
  return type;
}

export async function POST(request: Request, context: RouteContext) {
  const id = requestId(request);
  try {
    const { projectId } = await context.params;
    const { session } = await requireProjectAccess(projectId, "developer", request.headers);
    const limit = consumeRateLimit(`session:${session.user.id}:${projectId}`, { max: 60 });
    if (!limit.allowed) throw new MeldError({ code: "RATE_LIMITED", message: "SQL editor rate limit exceeded. Wait for the current window to reset.", status: 429, retryable: true });
    const input = inputSchema.parse(await request.json());
    if (input.target === "unified") {
      const result = await executeUnified({ projectId, userId: session.user.id, requestId: id, ...input });
      return Response.json({ data: result.rows, meta: { rowCount: result.rowCount, durationMs: result.durationMs, providers: result.providers, requestId: id } });
    }

    const rows = await db
      .select()
      .from(providerResources)
      .where(and(eq(providerResources.id, input.target), eq(providerResources.projectId, projectId)))
      .limit(1);
    const resource = rows[0];
    if (!resource) throw new MeldError({ code: "NOT_FOUND", message: "Physical database target not found.", status: 404 });
    const type = physicalStatementType(input.sql, resource.dialect === "sqlite" ? "sqlite" : "Postgresql");
    const destructive = new Set(["delete", "drop", "truncate", "alter"]);
    if (destructive.has(type) && !input.confirmDestructive) {
      throw new MeldError({ code: "INVALID_INPUT", message: `${type.toUpperCase()} requires an explicit destructive-query confirmation.`, status: 409 });
    }
    const { adapter } = await providerAdapterForProject(projectId, resource.provider, resource.externalId);
    const result = await adapter.executeSql({ resourceId: resource.externalId, sql: input.sql, params: input.params });
    return Response.json({ data: result.rows.slice(0, 1000), meta: { rowCount: result.rowCount, durationMs: result.durationMs, provider: resource.provider, dialect: resource.dialect, requestId: id } });
  } catch (error) {
    return errorResponse(error, id);
  }
}
