import { MeldError, type SqlDialect, type TableDescription } from "@melddb/core";
import { quoteIdentifier } from "./http";

const postgresTypes = new Set([
  "uuid",
  "text",
  "varchar",
  "boolean",
  "smallint",
  "integer",
  "bigint",
  "numeric",
  "real",
  "double precision",
  "json",
  "jsonb",
  "date",
  "timestamp",
  "timestamptz",
  "bytea",
]);

const sqliteTypes = new Set(["integer", "real", "text", "blob", "numeric"]);

const sqliteCanonicalTypes: Record<string, string> = {
  uuid: "text",
  varchar: "text",
  boolean: "integer",
  bigint: "integer",
  json: "text",
  jsonb: "text",
  date: "text",
  timestamp: "text",
  timestamptz: "text",
  bytea: "blob",
};

export function createTableSql(definition: TableDescription, dialect: SqlDialect): string {
  if (definition.columns.length === 0) {
    throw new MeldError({ code: "INVALID_INPUT", message: "A table requires at least one column.", status: 400 });
  }

  const allowed = dialect === "postgresql" ? postgresTypes : sqliteTypes;
  const columns = definition.columns.map((column) => {
    const requestedType = column.dataType.toLowerCase().trim();
    const normalizedType = dialect === "sqlite" ? (sqliteCanonicalTypes[requestedType] ?? requestedType) : requestedType;
    if (!allowed.has(normalizedType)) {
      throw new MeldError({
        code: "UNSUPPORTED",
        message: `${column.dataType} is not an allowed ${dialect} type in the visual table editor. Use Physical SQL for advanced types.`,
        status: 422,
      });
    }

    const fragments = [quoteIdentifier(column.name), normalizedType];
    if (column.primaryKey) fragments.push("PRIMARY KEY");
    if (!column.nullable) fragments.push("NOT NULL");
    return fragments.join(" ");
  });

  const qualified = definition.schema
    ? `${quoteIdentifier(definition.schema)}.${quoteIdentifier(definition.name)}`
    : quoteIdentifier(definition.name);
  return `CREATE TABLE ${qualified} (${columns.join(", ")})`;
}
