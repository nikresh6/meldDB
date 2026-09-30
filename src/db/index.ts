import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  meldSql?: ReturnType<typeof postgres>;
  meldDb?: ReturnType<typeof drizzle<typeof schema>>;
};

function databaseUrl(): string {
  return process.env.DATABASE_URL ?? "postgresql://placeholder:placeholder@localhost:5432/melddb";
}

export const sqlClient =
  globalForDb.meldSql ??
  postgres(databaseUrl(), {
    max: process.env.NODE_ENV === "production" ? 10 : 3,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });

export const db = globalForDb.meldDb ?? drizzle(sqlClient, { schema });

if (process.env.NODE_ENV !== "production") {
  globalForDb.meldSql = sqlClient;
  globalForDb.meldDb = db;
}

export function assertDatabaseConfigured(): void {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for control-plane operations.");
}
