export interface MeldDBOptions {
  apiKey: string;
  projectId: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

type Primitive = string | number | boolean | null;
type OrderDirection = "asc" | "desc";

interface QueryResponse<T> {
  data?: T[];
  meta?: { rowCount: number; durationMs: number | null; requestId: string };
  error?: { code: string; message: string; requestId: string };
}

class QueryBuilder<T extends Record<string, unknown>> implements PromiseLike<QueryResponse<T>> {
  private operation: "select" | "insert" | "update" | "delete" = "select";
  private columns = "*";
  private values: Record<string, Primitive> | null = null;
  private filters: Array<{ column: string; value: Primitive }> = [];
  private orderBy: { column: string; direction: OrderDirection } | null = null;
  private rowLimit: number | null = null;
  private rowOffset: number | null = null;
  private routingKeyValue: string | number | boolean | undefined;

  constructor(
    private readonly options: MeldDBOptions,
    private readonly table: string,
  ) {}

  select(columns = "*"): this {
    this.operation = "select";
    this.columns = columns;
    return this;
  }

  insert(values: Record<string, Primitive>): this {
    this.operation = "insert";
    this.values = values;
    return this;
  }

  update(values: Record<string, Primitive>): this {
    this.operation = "update";
    this.values = values;
    return this;
  }

  delete(): this {
    this.operation = "delete";
    return this;
  }

  eq(column: string, value: Primitive): this {
    this.filters.push({ column, value });
    return this;
  }

  order(column: string, direction: OrderDirection = "asc"): this {
    this.orderBy = { column, direction };
    return this;
  }

  limit(value: number): this {
    this.rowLimit = Math.max(1, Math.min(1000, Math.trunc(value)));
    return this;
  }

  offset(value: number): this {
    this.rowOffset = Math.max(0, Math.trunc(value));
    return this;
  }

  routeBy(value: string | number | boolean): this {
    this.routingKeyValue = value;
    return this;
  }

  then<TResult1 = QueryResponse<T>, TResult2 = never>(
    onfulfilled?: ((value: QueryResponse<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  async execute(): Promise<QueryResponse<T>> {
    const { sql, params } = this.compile();
    const fetcher = this.options.fetch ?? globalThis.fetch;
    const baseUrl = (this.options.baseUrl ?? "https://api.melddb.com").replace(/\/$/, "");
    const response = await fetcher(`${baseUrl}/api/v1/projects/${encodeURIComponent(this.options.projectId)}/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.options.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        sql,
        params,
        routingKey: this.routingKeyValue,
        confirmDestructive: this.operation === "delete",
      }),
    });
    return (await response.json()) as QueryResponse<T>;
  }

  private compile(): { sql: string; params: Primitive[] } {
    const quote = (identifier: string) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) throw new Error(`Invalid identifier: ${identifier}`);
      return `"${identifier}"`;
    };
    const table = quote(this.table);
    const params: Primitive[] = [];
    const placeholder = (value: Primitive) => {
      params.push(value);
      return `$${params.length}`;
    };
    const where = () =>
      this.filters.length
        ? ` WHERE ${this.filters.map((filter) => `${quote(filter.column)} = ${placeholder(filter.value)}`).join(" AND ")}`
        : "";

    if (this.operation === "insert") {
      if (!this.values || Object.keys(this.values).length === 0) throw new Error("insert() requires at least one value.");
      const entries = Object.entries(this.values);
      return {
        sql: `INSERT INTO ${table} (${entries.map(([column]) => quote(column)).join(", ")}) VALUES (${entries.map(([, value]) => placeholder(value)).join(", ")}) RETURNING *`,
        params,
      };
    }
    if (this.operation === "update") {
      if (!this.values || Object.keys(this.values).length === 0) throw new Error("update() requires at least one value.");
      const entries = Object.entries(this.values);
      const set = entries.map(([column, value]) => `${quote(column)} = ${placeholder(value)}`).join(", ");
      return { sql: `UPDATE ${table} SET ${set}${where()} RETURNING *`, params };
    }
    if (this.operation === "delete") return { sql: `DELETE FROM ${table}${where()} RETURNING *`, params };

    const selected =
      this.columns === "*"
        ? "*"
        : this.columns
            .split(",")
            .map((column) => quote(column.trim()))
            .join(", ");
    let sql = `SELECT ${selected} FROM ${table}${where()}`;
    if (this.orderBy) sql += ` ORDER BY ${quote(this.orderBy.column)} ${this.orderBy.direction.toUpperCase()}`;
    if (this.rowLimit !== null) sql += ` LIMIT ${this.rowLimit}`;
    if (this.rowOffset !== null) sql += ` OFFSET ${this.rowOffset}`;
    return { sql, params };
  }
}

export function createMeldDB(options: MeldDBOptions) {
  return {
    from<T extends Record<string, unknown> = Record<string, unknown>>(table: string) {
      return new QueryBuilder<T>(options, table);
    },
  };
}
