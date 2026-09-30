import { sql } from "drizzle-orm";
import { db } from "@/db";

export async function GET() {
  const started = performance.now();
  try {
    await db.execute(sql`select 1`);
    return Response.json({ status: "ok", controlPlane: "reachable", latencyMs: Math.round(performance.now() - started) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "degraded", controlPlane: "unreachable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
