import { and, eq } from "drizzle-orm";
import { MeldError, type QueryPrimitive } from "@melddb/core";
import { z } from "zod";
import { db } from "@/db";
import { logicalColumns, logicalTables } from "@/db/schema";
import { requireProjectAccess } from "@/lib/authorization";
import { executeUnified } from "@/lib/gateway";
import { errorResponse, requestId } from "@/lib/http";

const primitive = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const valuesSchema = z.record(z.string(), primitive);
type Context = { params: Promise<{ projectId: string; tableId: string }> };
const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

async function catalog(projectId: string, tableId: string) {
  const tables = await db.select().from(logicalTables).where(and(eq(logicalTables.id, tableId), eq(logicalTables.projectId, projectId))).limit(1);
  const table = tables[0];
  if (!table) throw new MeldError({ code: "NOT_FOUND", message: "Logical table not found.", status: 404 });
  const columns = await db.select().from(logicalColumns).where(eq(logicalColumns.tableId, table.id));
  return { table, columns, allowed: new Set(columns.map((column) => column.name)) };
}

function validateValues(values: Record<string, QueryPrimitive>, allowed: Set<string>) {
  for (const key of Object.keys(values)) if (!allowed.has(key)) throw new MeldError({ code: "INVALID_INPUT", message: `Column ${key} is not in the logical catalog.`, status: 400 });
}

export async function GET(request: Request, context: Context) {
  const id = requestId(request);
  try {
    const { projectId, tableId } = await context.params;
    const { session } = await requireProjectAccess(projectId, "viewer", request.headers);
    const { table } = await catalog(projectId, tableId);
    const url = new URL(request.url);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
    const result = await executeUnified({ projectId, userId: session.user.id, requestId: id, sql: `SELECT * FROM ${quote(table.name)} LIMIT ${limit} OFFSET ${offset}`, params: [] });
    return Response.json({ data: result.rows, meta: { rowCount: result.rowCount, durationMs: result.durationMs, requestId: id } });
  } catch (error) { return errorResponse(error, id); }
}

export async function POST(request: Request, context: Context) {
  const id = requestId(request);
  try {
    const { projectId, tableId } = await context.params;
    const { session } = await requireProjectAccess(projectId, "developer", request.headers);
    const { table, allowed } = await catalog(projectId, tableId);
    const values = valuesSchema.parse(await request.json()) as Record<string, QueryPrimitive>;
    validateValues(values, allowed);
    const names = Object.keys(values);
    if (!names.length) throw new MeldError({ code: "INVALID_INPUT", message: "Provide at least one column value.", status: 400 });
    const params = names.map((name) => values[name] ?? null);
    const routingKey = table.primaryKeyColumn ? values[table.primaryKeyColumn] : undefined;
    if (routingKey === undefined || routingKey === null) throw new MeldError({ code: "INVALID_INPUT", message: `Provide primary key ${table.primaryKeyColumn}.`, status: 400 });
    const sql = `INSERT INTO ${quote(table.name)} (${names.map(quote).join(", ")}) VALUES (${names.map((_, index) => `$${index + 1}`).join(", ")})`;
    const result = await executeUnified({ projectId, userId: session.user.id, requestId: id, sql, params, routingKey });
    return Response.json({ data: result.rows, meta: { rowCount: result.rowCount, requestId: id } }, { status: 201 });
  } catch (error) { return errorResponse(error, id); }
}

export async function PATCH(request: Request, context: Context) {
  const id = requestId(request);
  try {
    const { projectId, tableId } = await context.params;
    const { session } = await requireProjectAccess(projectId, "developer", request.headers);
    const { table, allowed } = await catalog(projectId, tableId);
    if (!table.primaryKeyColumn) throw new MeldError({ code: "INVALID_INPUT", message: "Row editing requires a primary key.", status: 400 });
    const body = z.object({ primaryKey: primitive, values: valuesSchema }).parse(await request.json());
    const values = body.values as Record<string, QueryPrimitive>; validateValues(values, allowed);
    const names = Object.keys(values).filter((name) => name !== table.primaryKeyColumn);
    if (!names.length) throw new MeldError({ code: "INVALID_INPUT", message: "No editable values were provided.", status: 400 });
    const params = [...names.map((name) => values[name] ?? null), body.primaryKey] as QueryPrimitive[];
    const sql = `UPDATE ${quote(table.name)} SET ${names.map((name, index) => `${quote(name)} = $${index + 1}`).join(", ")} WHERE ${quote(table.primaryKeyColumn)} = $${params.length}`;
    const result = await executeUnified({ projectId, userId: session.user.id, requestId: id, sql, params, routingKey: body.primaryKey ?? undefined });
    return Response.json({ data: result.rows, meta: { rowCount: result.rowCount, requestId: id } });
  } catch (error) { return errorResponse(error, id); }
}

export async function DELETE(request: Request, context: Context) {
  const id = requestId(request);
  try {
    const { projectId, tableId } = await context.params;
    const { session } = await requireProjectAccess(projectId, "developer", request.headers);
    const { table } = await catalog(projectId, tableId);
    if (!table.primaryKeyColumn) throw new MeldError({ code: "INVALID_INPUT", message: "Row deletion requires a primary key.", status: 400 });
    const body = z.object({ primaryKey: primitive, confirm: z.literal(true) }).parse(await request.json());
    const sql = `DELETE FROM ${quote(table.name)} WHERE ${quote(table.primaryKeyColumn)} = $1`;
    const result = await executeUnified({ projectId, userId: session.user.id, requestId: id, sql, params: [body.primaryKey], routingKey: body.primaryKey ?? undefined, confirmDestructive: true });
    return Response.json({ data: result.rows, meta: { rowCount: result.rowCount, requestId: id } });
  } catch (error) { return errorResponse(error, id); }
}
