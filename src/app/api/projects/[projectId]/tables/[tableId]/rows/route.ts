import { and, eq } from "drizzle-orm";
import { MeldError, routeToShard, type ProviderId, type QueryPrimitive } from "@melddb/core";
import { z } from "zod";
import { db } from "@/db";
import {
  logicalColumns,
  logicalTables,
  physicalShards,
  providerResources,
  shardPlacements,
} from "@/db/schema";
import { requireProjectAccess } from "@/lib/authorization";
import { errorResponse, requestId } from "@/lib/http";
import { providerAdapterForProject } from "@/lib/provider-service";

const primitive = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const valuesSchema = z.record(z.string(), primitive);
type Context = { params: Promise<{ projectId: string; tableId: string }> };
const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

interface Placement {
  shardId: string;
  provider: ProviderId;
  externalId: string;
  physicalSchema: string | null;
  physicalTable: string;
}

async function catalog(projectId: string, tableId: string) {
  const tables = await db
    .select()
    .from(logicalTables)
    .where(and(eq(logicalTables.id, tableId), eq(logicalTables.projectId, projectId)))
    .limit(1);
  const table = tables[0];
  if (!table) throw new MeldError({ code: "NOT_FOUND", message: "Logical table not found.", status: 404 });
  const columns = await db.select().from(logicalColumns).where(eq(logicalColumns.tableId, table.id));
  return { table, columns, allowed: new Set(columns.map((column) => column.name)) };
}

async function placements(tableId: string): Promise<Placement[]> {
  const rows = await db
    .select({
      shardId: physicalShards.id,
      provider: providerResources.provider,
      externalId: providerResources.externalId,
      physicalSchema: shardPlacements.physicalSchema,
      physicalTable: shardPlacements.physicalTable,
    })
    .from(physicalShards)
    .innerJoin(shardPlacements, eq(physicalShards.id, shardPlacements.shardId))
    .innerJoin(providerResources, eq(shardPlacements.providerResourceId, providerResources.id))
    .where(and(eq(physicalShards.logicalTableId, tableId), eq(physicalShards.state, "active")));

  if (!rows.length) {
    throw new MeldError({
      code: "PROVIDER_UNREACHABLE",
      message: "This table has no active database placement.",
      status: 503,
    });
  }
  return rows;
}

function physicalName(target: Placement) {
  return target.physicalSchema
    ? `${quote(target.physicalSchema)}.${quote(target.physicalTable)}`
    : quote(target.physicalTable);
}

async function executeOnPlacement(
  projectId: string,
  target: Placement,
  sql: string,
  params: QueryPrimitive[],
  write = false,
) {
  const { adapter } = await providerAdapterForProject(projectId, target.provider, target.externalId);
  const request = { resourceId: target.externalId, sql, params };
  return write ? adapter.executeWrite(request) : adapter.executeRead(request);
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}

function validateValues(values: Record<string, QueryPrimitive>, allowed: Set<string>) {
  for (const key of Object.keys(values)) {
    if (!allowed.has(key)) {
      throw new MeldError({
        code: "INVALID_INPUT",
        message: `Column ${key} is not in the logical catalog.`,
        status: 400,
      });
    }
  }
}

function choosePlacement(targets: Placement[], routingKey: QueryPrimitive | undefined): Placement {
  if (targets.length === 1) return targets[0]!;
  if (routingKey === undefined || routingKey === null) {
    throw new MeldError({
      code: "INVALID_INPUT",
      message: "A primary-key routing value is required to write to a sharded table.",
      status: 400,
    });
  }
  const shardId = routeToShard(routingKey, targets.map((target) => target.shardId));
  const target = targets.find((candidate) => candidate.shardId === shardId);
  if (!target) {
    throw new MeldError({ code: "PROVIDER_UNREACHABLE", message: "No writable shard placement was found.", status: 503 });
  }
  return target;
}

export async function GET(request: Request, context: Context) {
  const id = requestId(request);
  try {
    const { projectId, tableId } = await context.params;
    await requireProjectAccess(projectId, "viewer", request.headers);
    await catalog(projectId, tableId);

    const url = new URL(request.url);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
    const targets = await placements(tableId);

    // Pull enough rows from each shard to create the requested page locally.
    // This keeps the Table Editor independent from Unified SQL parsing and telemetry writes.
    const fetchLimit = Math.min(1000, limit + offset);
    const results = await Promise.all(
      targets.map((target) =>
        executeOnPlacement(
          projectId,
          target,
          `SELECT * FROM ${physicalName(target)} LIMIT ${fetchLimit}`,
          [],
        ),
      ),
    );

    const merged = results.flatMap((result) => result.rows);
    const pageRows = merged.slice(offset, offset + limit).map((row) => jsonSafe(row));

    return Response.json({
      data: pageRows,
      meta: {
        rowCount: pageRows.length,
        fetched: merged.length,
        nodes: targets.length,
        requestId: id,
      },
    });
  } catch (error) {
    return errorResponse(error, id);
  }
}

export async function POST(request: Request, context: Context) {
  const id = requestId(request);
  try {
    const { projectId, tableId } = await context.params;
    await requireProjectAccess(projectId, "developer", request.headers);
    const { table, allowed } = await catalog(projectId, tableId);
    const values = valuesSchema.parse(await request.json()) as Record<string, QueryPrimitive>;
    validateValues(values, allowed);

    const names = Object.keys(values);
    if (!names.length) {
      throw new MeldError({ code: "INVALID_INPUT", message: "Provide at least one column value.", status: 400 });
    }

    const routingKey = table.primaryKeyColumn ? values[table.primaryKeyColumn] : undefined;
    if (table.primaryKeyColumn && (routingKey === undefined || routingKey === null)) {
      throw new MeldError({
        code: "INVALID_INPUT",
        message: `Provide primary key ${table.primaryKeyColumn}.`,
        status: 400,
      });
    }

    const targets = await placements(tableId);
    const target = choosePlacement(targets, routingKey);
    const params = names.map((name) => values[name] ?? null);
    const sql = `INSERT INTO ${physicalName(target)} (${names.map(quote).join(", ")}) VALUES (${names
      .map((_, index) => `$${index + 1}`)
      .join(", ")}) RETURNING *`;

    const result = await executeOnPlacement(projectId, target, sql, params, true);
    return Response.json(
      { data: result.rows.map((row) => jsonSafe(row)), meta: { rowCount: result.rowCount, requestId: id } },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, id);
  }
}

export async function PATCH(request: Request, context: Context) {
  const id = requestId(request);
  try {
    const { projectId, tableId } = await context.params;
    await requireProjectAccess(projectId, "developer", request.headers);
    const { table, allowed } = await catalog(projectId, tableId);
    if (!table.primaryKeyColumn) {
      throw new MeldError({ code: "INVALID_INPUT", message: "Row editing requires a primary key.", status: 400 });
    }

    const body = z.object({ primaryKey: primitive, values: valuesSchema }).parse(await request.json());
    const values = body.values as Record<string, QueryPrimitive>;
    validateValues(values, allowed);

    const names = Object.keys(values).filter((name) => name !== table.primaryKeyColumn);
    if (!names.length) {
      throw new MeldError({ code: "INVALID_INPUT", message: "No editable values were provided.", status: 400 });
    }

    const targets = await placements(tableId);
    const target = choosePlacement(targets, body.primaryKey);
    const params = [...names.map((name) => values[name] ?? null), body.primaryKey] as QueryPrimitive[];
    const sql = `UPDATE ${physicalName(target)} SET ${names
      .map((name, index) => `${quote(name)} = $${index + 1}`)
      .join(", ")} WHERE ${quote(table.primaryKeyColumn)} = $${params.length} RETURNING *`;

    const result = await executeOnPlacement(projectId, target, sql, params, true);
    return Response.json({
      data: result.rows.map((row) => jsonSafe(row)),
      meta: { rowCount: result.rowCount, requestId: id },
    });
  } catch (error) {
    return errorResponse(error, id);
  }
}

export async function DELETE(request: Request, context: Context) {
  const id = requestId(request);
  try {
    const { projectId, tableId } = await context.params;
    await requireProjectAccess(projectId, "developer", request.headers);
    const { table } = await catalog(projectId, tableId);
    if (!table.primaryKeyColumn) {
      throw new MeldError({ code: "INVALID_INPUT", message: "Row deletion requires a primary key.", status: 400 });
    }

    const body = z.object({ primaryKey: primitive, confirm: z.literal(true) }).parse(await request.json());
    const targets = await placements(tableId);
    const target = choosePlacement(targets, body.primaryKey);
    const sql = `DELETE FROM ${physicalName(target)} WHERE ${quote(table.primaryKeyColumn)} = $1 RETURNING *`;

    const result = await executeOnPlacement(projectId, target, sql, [body.primaryKey], true);
    return Response.json({
      data: result.rows.map((row) => jsonSafe(row)),
      meta: { rowCount: result.rowCount, requestId: id },
    });
  } catch (error) {
    return errorResponse(error, id);
  }
}
