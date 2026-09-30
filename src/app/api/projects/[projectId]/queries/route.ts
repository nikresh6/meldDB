import { and, desc, eq } from "drizzle-orm";
import { MeldError } from "@melddb/core";
import { z } from "zod";
import { db } from "@/db";
import { savedQueries } from "@/db/schema";
import { requireProjectAccess } from "@/lib/authorization";
import { errorResponse, requestId } from "@/lib/http";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: Context) {
  const id = requestId(request);
  try {
    const { projectId } = await context.params; const { session } = await requireProjectAccess(projectId, "viewer", request.headers);
    const rows = await db.select({ id: savedQueries.id, title: savedQueries.title, sql: savedQueries.sql, target: savedQueries.target, updatedAt: savedQueries.updatedAt }).from(savedQueries).where(and(eq(savedQueries.projectId, projectId), eq(savedQueries.userId, session.user.id))).orderBy(desc(savedQueries.updatedAt)).limit(100);
    return Response.json({ data: rows, meta: { requestId: id } });
  } catch (error) { return errorResponse(error, id); }
}

export async function POST(request: Request, context: Context) {
  const id = requestId(request);
  try {
    const { projectId } = await context.params; const { session } = await requireProjectAccess(projectId, "developer", request.headers);
    const input = z.object({ title: z.string().trim().min(1).max(160), sql: z.string().min(1).max(100_000), target: z.string().max(255).default("unified") }).parse(await request.json());
    const row = (await db.insert(savedQueries).values({ projectId, userId: session.user.id, ...input }).returning())[0];
    return Response.json({ data: row, meta: { requestId: id } }, { status: 201 });
  } catch (error) { return errorResponse(error, id); }
}

export async function DELETE(request: Request, context: Context) {
  const id = requestId(request);
  try {
    const { projectId } = await context.params; const { session } = await requireProjectAccess(projectId, "developer", request.headers); const queryId = new URL(request.url).searchParams.get("id");
    if (!queryId) throw new MeldError({ code: "INVALID_INPUT", message: "Saved query id is required.", status: 400 });
    const deleted = await db.delete(savedQueries).where(and(eq(savedQueries.id, queryId), eq(savedQueries.projectId, projectId), eq(savedQueries.userId, session.user.id))).returning({ id: savedQueries.id });
    if (!deleted.length) throw new MeldError({ code: "NOT_FOUND", message: "Saved query not found.", status: 404 });
    return Response.json({ data: { deleted: true }, meta: { requestId: id } });
  } catch (error) { return errorResponse(error, id); }
}
