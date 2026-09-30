import { and, eq } from "drizzle-orm";
import { MeldError } from "@melddb/core";
import { z } from "zod";
import { db } from "@/db";
import { functionMetadataCache, providerConnections, providerResources } from "@/db/schema";
import { requireProjectAccess } from "@/lib/authorization";
import { errorResponse, requestId } from "@/lib/http";
import { supabaseManagementRequest } from "@/lib/supabase-management";

type Context = { params: Promise<{ projectId: string }> };
const deploySchema = z.object({ slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64), source: z.string().min(1).max(500_000), verifyJwt: z.boolean().default(true) });

async function supabaseResource(projectId: string) {
  const rows = await db.select({ resource: providerResources, connection: providerConnections }).from(providerResources).innerJoin(providerConnections, eq(providerResources.connectionId, providerConnections.id)).where(and(eq(providerResources.projectId, projectId), eq(providerResources.provider, "supabase"))).limit(1);
  const row = rows[0];
  if (!row) throw new MeldError({ code: "NOT_FOUND", message: "Edge Functions require an attached Supabase project.", status: 404 });
  return row;
}

function asFunctions(value: unknown): Array<Record<string, unknown>> { return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : []; }

export async function GET(request: Request, context: Context) {
  const id = requestId(request);
  try {
    const { projectId } = await context.params; await requireProjectAccess(projectId, "viewer", request.headers); const { resource, connection } = await supabaseResource(projectId);
    const functions = asFunctions(await supabaseManagementRequest(connection.id, `/v1/projects/${encodeURIComponent(resource.externalId)}/functions`));
    for (const item of functions) {
      const externalId = String(item.id ?? item.slug ?? item.name ?? ""); if (!externalId) continue;
      await db.insert(functionMetadataCache).values({ providerResourceId: resource.id, externalId, name: String(item.name ?? item.slug ?? externalId), status: typeof item.status === "string" ? item.status : null, version: item.version === undefined ? null : String(item.version), metadata: { verifyJwt: item.verify_jwt ?? null }, refreshedAt: new Date() }).onConflictDoUpdate({ target: [functionMetadataCache.providerResourceId, functionMetadataCache.externalId], set: { status: typeof item.status === "string" ? item.status : null, version: item.version === undefined ? null : String(item.version), refreshedAt: new Date() } });
    }
    return Response.json({ data: functions.map((item) => ({ id: item.id, slug: item.slug ?? item.name, status: item.status, version: item.version, verifyJwt: item.verify_jwt })), meta: { provider: "supabase", requestId: id } });
  } catch (error) { return errorResponse(error, id); }
}

export async function POST(request: Request, context: Context) {
  const id = requestId(request);
  try {
    const { projectId } = await context.params; await requireProjectAccess(projectId, "developer", request.headers); const input = deploySchema.parse(await request.json()); const { resource, connection } = await supabaseResource(projectId);
    const form = new FormData();
    form.set("metadata", new Blob([JSON.stringify({ entrypoint_path: "index.ts", import_map_path: null, verify_jwt: input.verifyJwt })], { type: "application/json" }));
    form.set("file", new File([input.source], "index.ts", { type: "application/typescript" }));
    const result = await supabaseManagementRequest(connection.id, `/v1/projects/${encodeURIComponent(resource.externalId)}/functions/deploy?slug=${encodeURIComponent(input.slug)}`, { method: "POST", body: form });
    return Response.json({ data: result, meta: { sourcePersisted: false, requestId: id } }, { status: 201 });
  } catch (error) { return errorResponse(error, id); }
}

export async function DELETE(request: Request, context: Context) {
  const id = requestId(request);
  try {
    const { projectId } = await context.params; await requireProjectAccess(projectId, "admin", request.headers); const url = new URL(request.url); const slug = url.searchParams.get("slug"); const confirmation = url.searchParams.get("confirm");
    if (!slug || confirmation !== slug) throw new MeldError({ code: "INVALID_INPUT", message: "Deleting a function requires its exact slug as confirmation.", status: 400 });
    const { resource, connection } = await supabaseResource(projectId);
    await supabaseManagementRequest(connection.id, `/v1/projects/${encodeURIComponent(resource.externalId)}/functions/${encodeURIComponent(slug)}`, { method: "DELETE" });
    return Response.json({ data: { deleted: true }, meta: { requestId: id } });
  } catch (error) { return errorResponse(error, id); }
}
