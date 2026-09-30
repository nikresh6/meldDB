import { and, eq } from "drizzle-orm";
import type { DatabaseProviderAdapter, TableDescription } from "@melddb/core";
import { db } from "@/db";
import { logicalColumns, logicalTables, physicalShards, providerResources, routingRules, shardPlacements } from "@/db/schema";

export interface SchemaSyncResult {
  discovered: number;
  imported: number;
  updated: number;
  conflicts: number;
  skippedNonPublic: number;
}

function canonicalType(dataType: string): string {
  const value = dataType.toLowerCase();
  if (value === "uuid") return "uuid";
  if (["smallint", "integer", "serial", "smallserial"].includes(value)) return "integer";
  if (["bigint", "bigserial"].includes(value)) return "bigint";
  if (["numeric", "decimal", "real", "double precision"].includes(value)) return "numeric";
  if (value === "boolean") return "boolean";
  if (value.includes("timestamp") || value === "date" || value.startsWith("time ")) return "timestamp";
  if (value === "json" || value === "jsonb") return "json";
  return "text";
}

async function hasPlacement(tableId: string, resourceId: string, physicalTable: string) {
  const rows = await db.select({ id: shardPlacements.id })
    .from(physicalShards)
    .innerJoin(shardPlacements, eq(physicalShards.id, shardPlacements.shardId))
    .where(and(
      eq(physicalShards.logicalTableId, tableId),
      eq(shardPlacements.providerResourceId, resourceId),
      eq(shardPlacements.physicalTable, physicalTable),
    ))
    .limit(1);
  return rows.length > 0;
}

async function refreshTable(tableId: string, table: TableDescription) {
  const primaryKey = table.columns.find((column) => column.primaryKey)?.name ?? null;
  await db.transaction(async (tx) => {
    await tx.update(logicalTables).set({ primaryKeyColumn: primaryKey, updatedAt: new Date() }).where(eq(logicalTables.id, tableId));
    await tx.delete(logicalColumns).where(eq(logicalColumns.tableId, tableId));
    if (table.columns.length) {
      await tx.insert(logicalColumns).values(table.columns.map((column, ordinal) => ({
        tableId,
        name: column.name,
        canonicalType: canonicalType(column.dataType),
        nullable: column.nullable,
        primaryKey: column.primaryKey,
        defaultExpression: column.defaultValue,
        ordinal,
      })));
    }
    await tx.delete(routingRules).where(eq(routingRules.logicalTableId, tableId));
    if (primaryKey) await tx.insert(routingRules).values({ logicalTableId: tableId, routingColumn: primaryKey });
  });
}

export async function syncProviderResourceSchema(input: {
  projectId: string;
  resourceId: string;
  externalId: string;
  adapter: DatabaseProviderAdapter;
}): Promise<SchemaSyncResult> {
  const rows = await db.select().from(providerResources)
    .where(and(eq(providerResources.id, input.resourceId), eq(providerResources.projectId, input.projectId)))
    .limit(1);
  const resource = rows[0];
  if (!resource) throw new Error("Provider resource is not attached.");

  const schema = await input.adapter.getSchema(input.externalId);
  const result: SchemaSyncResult = { discovered: schema.length, imported: 0, updated: 0, conflicts: 0, skippedNonPublic: 0 };

  for (const table of schema) {
    const schemaName = table.schema ?? "public";
    if (resource.dialect === "postgresql" && schemaName !== "public") {
      result.skippedNonPublic++;
      continue;
    }

    const existingRows = await db.select().from(logicalTables)
      .where(and(eq(logicalTables.projectId, input.projectId), eq(logicalTables.schemaName, schemaName), eq(logicalTables.name, table.name)))
      .limit(1);
    const existing = existingRows[0];

    if (existing) {
      if (!(await hasPlacement(existing.id, resource.id, table.name))) {
        result.conflicts++;
        continue;
      }
      await refreshTable(existing.id, table);
      result.updated++;
      continue;
    }

    const primaryKey = table.columns.find((column) => column.primaryKey)?.name ?? null;
    await db.transaction(async (tx) => {
      const logical = (await tx.insert(logicalTables).values({
        projectId: input.projectId,
        schemaName,
        name: table.name,
        primaryKeyColumn: primaryKey,
      }).returning())[0];
      if (!logical) throw new Error("Logical table was not created.");

      if (table.columns.length) {
        await tx.insert(logicalColumns).values(table.columns.map((column, ordinal) => ({
          tableId: logical.id,
          name: column.name,
          canonicalType: canonicalType(column.dataType),
          nullable: column.nullable,
          primaryKey: column.primaryKey,
          defaultExpression: column.defaultValue,
          ordinal,
        })));
      }

      const shard = (await tx.insert(physicalShards).values({
        logicalTableId: logical.id,
        shardNumber: 0,
        state: "active",
      }).returning())[0];
      if (!shard) throw new Error("Physical shard was not created.");

      await tx.insert(shardPlacements).values({
        shardId: shard.id,
        providerResourceId: resource.id,
        physicalSchema: resource.dialect === "sqlite" ? null : schemaName,
        physicalTable: table.name,
      });

      if (primaryKey) await tx.insert(routingRules).values({ logicalTableId: logical.id, routingColumn: primaryKey });
    });

    result.imported++;
  }

  return result;
}
