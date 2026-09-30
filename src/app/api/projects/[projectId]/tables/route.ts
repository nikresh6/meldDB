import { and, eq } from "drizzle-orm";
import { MeldError, type ColumnDescription, type TableDescription } from "@melddb/core";
import { z } from "zod";
import { db } from "@/db";
import { logicalColumns, logicalTables, physicalShards, providerResources, routingRules, shardPlacements } from "@/db/schema";
import { requireProjectAccess } from "@/lib/authorization";
import { errorResponse, requestId } from "@/lib/http";
import { providerAdapterForProject } from "@/lib/provider-service";

const identifier = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Use letters, numbers, and underscores; start with a letter or underscore.").max(63);
const canonicalTypes = ["uuid", "text", "integer", "bigint", "numeric", "boolean", "timestamp", "json"] as const;
const inputSchema = z.object({
  name: identifier,
  schema: identifier.default("public"),
  resourceId: z.string().uuid(),
  columns: z.array(z.object({ name: identifier, type: z.enum(canonicalTypes), nullable: z.boolean().default(true), primaryKey: z.boolean().default(false) })).min(1).max(100),
});
type RouteContext = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const id = requestId(request);
  try {
    const { projectId } = await context.params;
    await requireProjectAccess(projectId, "developer", request.headers);
    const input = inputSchema.parse(await request.json());
    const primaryKeys = input.columns.filter((column) => column.primaryKey);
    if (primaryKeys.length !== 1) throw new MeldError({ code: "INVALID_INPUT", message: "V1 logical tables require exactly one primary key for deterministic routing.", status: 400 });
    if (new Set(input.columns.map((column) => column.name)).size !== input.columns.length) throw new MeldError({ code: "INVALID_INPUT", message: "Column names must be unique.", status: 400 });
    const resourceRows = await db.select().from(providerResources).where(and(eq(providerResources.id, input.resourceId), eq(providerResources.projectId, projectId))).limit(1);
    const resource = resourceRows[0];
    if (!resource) throw new MeldError({ code: "NOT_FOUND", message: "The selected physical database does not belong to this project.", status: 404 });
    const { adapter } = await providerAdapterForProject(projectId, resource.provider, resource.externalId);
    const columns: ColumnDescription[] = input.columns.map((column) => ({ name: column.name, dataType: column.type, nullable: column.primaryKey ? false : column.nullable, primaryKey: column.primaryKey, defaultValue: null }));
    const definition: TableDescription = { name: input.name, schema: resource.dialect === "sqlite" ? null : input.schema, rowCount: 0, columns };
    await adapter.createTable(resource.externalId, definition);
    try {
      const table = await db.transaction(async (transaction) => {
        const created = (await transaction.insert(logicalTables).values({ projectId, schemaName: input.schema, name: input.name, primaryKeyColumn: primaryKeys[0]!.name }).returning())[0];
        if (!created) throw new Error("Logical table catalog entry was not created.");
        await transaction.insert(logicalColumns).values(input.columns.map((column, ordinal) => ({ tableId: created.id, name: column.name, canonicalType: column.type, nullable: column.primaryKey ? false : column.nullable, primaryKey: column.primaryKey, ordinal })));
        const shard = (await transaction.insert(physicalShards).values({ logicalTableId: created.id, shardNumber: 0, state: "active" }).returning())[0];
        if (!shard) throw new Error("Initial shard was not created.");
        await transaction.insert(shardPlacements).values({ shardId: shard.id, providerResourceId: resource.id, physicalSchema: resource.dialect === "sqlite" ? null : input.schema, physicalTable: input.name });
        await transaction.insert(routingRules).values({ logicalTableId: created.id, routingColumn: primaryKeys[0]!.name });
        return created;
      });
      return Response.json({ data: table }, { status: 201, headers: { "x-request-id": id } });
    } catch (error) {
      await adapter.dropTable(resource.externalId, input.name, resource.dialect === "sqlite" ? undefined : input.schema).catch(() => undefined);
      throw error;
    }
  } catch (error) { return errorResponse(error, id); }
}
