import { and, eq } from "drizzle-orm";
import { MeldError } from "@melddb/core";
import { z } from "zod";
import { db } from "@/db";
import { authConfigCache, providerConnections, providerResources } from "@/db/schema";
import { requireProjectAccess } from "@/lib/authorization";
import { errorResponse, requestId } from "@/lib/http";
import { redactConfig, supabaseManagementRequest } from "@/lib/supabase-management";

type Context = { params: Promise<{ projectId: string }> };
const editable = z.object({
  disable_signup: z.boolean().optional(),
  external_anonymous_users_enabled: z.boolean().optional(),
  site_url: z.string().url().max(2048).optional(),
  uri_allow_list: z.string().max(10_000).optional(),
  jwt_exp: z.number().int().min(300).max(604800).optional(),
  password_min_length: z.number().int().min(6).max(72).optional(),
  security_captcha_enabled: z.boolean().optional(),
  mailer_autoconfirm: z.boolean().optional(),
}).strict();

async function supabaseResource(projectId: string) {
  const rows = await db.select({ resource: providerResources, connection: providerConnections }).from(providerResources).innerJoin(providerConnections, eq(providerResources.connectionId, providerConnections.id)).where(and(eq(providerResources.projectId, projectId), eq(providerResources.provider, "supabase"))).limit(1);
  const row = rows[0];
  if (!row) throw new MeldError({ code: "NOT_FOUND", message: "Authentication requires an attached Supabase project.", status: 404 });
  return row;
}

export async function GET(request: Request, context: Context) {
  const id = requestId(request);
  try {
    const { projectId } = await context.params; await requireProjectAccess(projectId, "viewer", request.headers);
    const { resource, connection } = await supabaseResource(projectId);
    const live = await supabaseManagementRequest<Record<string, unknown>>(connection.id, `/v1/projects/${encodeURIComponent(resource.externalId)}/config/auth`);
    const safe = redactConfig(live) as Record<string, unknown>;
    await db.insert(authConfigCache).values({ providerResourceId: resource.id, safeConfig: safe, refreshedAt: new Date() }).onConflictDoUpdate({ target: authConfigCache.providerResourceId, set: { safeConfig: safe, refreshedAt: new Date() } });
    return Response.json({ data: safe, meta: { provider: "supabase", resource: resource.name, requestId: id } });
  } catch (error) { return errorResponse(error, id); }
}

export async function PATCH(request: Request, context: Context) {
  const id = requestId(request);
  try {
    const { projectId } = await context.params; await requireProjectAccess(projectId, "admin", request.headers);
    const input = editable.parse(await request.json()); const { resource, connection } = await supabaseResource(projectId);
    const live = await supabaseManagementRequest<Record<string, unknown>>(connection.id, `/v1/projects/${encodeURIComponent(resource.externalId)}/config/auth`, { method: "PATCH", body: JSON.stringify(input) });
    return Response.json({ data: redactConfig(live), meta: { requestId: id } });
  } catch (error) { return errorResponse(error, id); }
}
