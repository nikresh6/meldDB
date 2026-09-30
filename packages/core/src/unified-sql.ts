import { Parser } from "node-sql-parser";
import { MeldError } from "./errors";

export type UnifiedSqlOperation = "select" | "insert" | "update" | "delete";

export interface UnifiedSqlPlan {
  operation: UnifiedSqlOperation;
  table: string;
  schema: string | null;
  isWrite: boolean;
  requiresConfirmation: boolean;
}

interface AstTableReference {
  table?: string;
  db?: string | null;
  join?: string;
}

interface AstStatement {
  type?: string;
  table?: AstTableReference[];
  from?: AstTableReference[];
  _next?: unknown;
  union?: unknown;
  groupby?: unknown;
}

const allowedOperations = new Set<UnifiedSqlOperation>(["select", "insert", "update", "delete"]);

export function classifyUnifiedSql(sql: string): UnifiedSqlPlan {
  let parsed: unknown;
  try {
    parsed = new Parser().astify(sql, { database: "Postgresql" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The SQL parser rejected this statement.";
    throw new MeldError({ code: "INVALID_INPUT", message: `SQL could not be parsed: ${detail}`, status: 400 });
  }

  if (Array.isArray(parsed)) {
    throw new MeldError({
      code: "UNSUPPORTED_SQL",
      message: "Unified SQL accepts one statement at a time. Run statements separately or choose a physical provider.",
      status: 422,
    });
  }

  const statement = parsed as AstStatement;
  const operation = statement.type?.toLowerCase() as UnifiedSqlOperation | undefined;
  if (!operation || !allowedOperations.has(operation)) {
    throw new MeldError({
      code: "UNSUPPORTED_SQL",
      message: "Unified SQL supports SELECT, INSERT, UPDATE, and DELETE. Choose a physical provider for dialect-specific DDL.",
      status: 422,
    });
  }

  if (statement.union || statement._next || statement.groupby) {
    throw new MeldError({
      code: "UNSUPPORTED_SQL",
      message: "This query shape is not supported by Unified SQL yet. Run it against one physical database or simplify the query.",
      status: 422,
    });
  }

  const references = operation === "select" ? statement.from : statement.table;
  if (!references || references.length !== 1 || references[0]?.join) {
    throw new MeldError({
      code: "UNSUPPORTED_SQL",
      message:
        "This query requires a cross-provider join, which Unified SQL does not support yet. Run it against a single physical database, colocate these tables, or query through the SDK.",
      status: 422,
    });
  }

  const reference = references[0];
  if (!reference?.table) {
    throw new MeldError({ code: "INVALID_INPUT", message: "Unified SQL requires one cataloged table.", status: 400 });
  }

  return {
    operation,
    table: reference.table,
    schema: reference.db ?? null,
    isWrite: operation !== "select",
    requiresConfirmation: operation === "delete",
  };
}
