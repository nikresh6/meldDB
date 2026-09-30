import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sqlClient } from "../src/db";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env.local and add the pooled Neon URL.");
}

await migrate(db, { migrationsFolder: "drizzle" });
await sqlClient.end();
