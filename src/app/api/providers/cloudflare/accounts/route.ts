import { and, eq } from "drizzle-orm";
import { MeldError } from "@melddb/core";
import { z } from "zod";
import { db } from "@/db";
import { providerConnections } from "@/db/schema";
import { requireWorkspaceAccess } from "@/lib/authorization";
import { decryptedCredential } from "@/lib/provider-service";
import { errorResponse, requestId } from "@/lib/http";

async function connectionFor(workspaceId: string) {
  const rows = await db.select().from(providerConnections).where(and(eq(providerConnections.workspaceId, workspaceId), eq(providerConnections.provider, "cloudflare-d1"))).limit(1);
  const connection = rows[0];
  if (!connection) throw new MeldError({ code: "NOT_FOUND", message: "Cloudflare is not connected to this workspace.", status: 404 });
  const token = await decryptedCredential(connection.id, "oauth_access_token");
  if (!token) throw new MeldError({ code: "CREDENTIALS_EXPIRED", message: "Reconnect Cloudflare to select an account.", status: 401 });
  return { connection, token };
}

async function accounts(token: string): Promise<Array<{ id: string; name: string }>> {
  const response = await fetch("https://api.cloudflare.com/client/v4/accounts?per_page=50", { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new MeldError({ code: response.status === 403 ? "PERMISSION_MISSING" : "PROVIDER_ERROR", message: "Cloudflare accounts could not be read with the granted permission.", status: response.status === 403 ? 403 : 502 });
  return Array.isArray(body.result) ? body.result.flatMap((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string" ? [{ id: String((item as Record<string, unknown>).id), name: String((item as Record<string, unknown>).name ?? (item as Record<string, unknown>).id) }] : []) : [];
}

export async function GET(request: Request) {
  const id = requestId(request);
  try {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId"); if (!workspaceId) throw new MeldError({ code: "INVALID_INPUT", message: "workspaceId is required.", status: 400 });
    await requireWorkspaceAccess(workspaceId, "admin", request.headers); const resolved = await connectionFor(workspaceId);
    return Response.json({ data: await accounts(resolved.token), selectedAccountId: resolved.connection.externalAccountId }, { headers: { "x-request-id": id } });
  } catch (error) { return errorResponse(error, id); }
}

export async function PATCH(request: Request) {
  const id = requestId(request);
  try {
    const input = z.object({ workspaceId: z.string().uuid(), accountId: z.string().min(1).max(255) }).parse(await request.json());
    await requireWorkspaceAccess(input.workspaceId, "admin", request.headers); const resolved = await connectionFor(input.workspaceId); const available = await accounts(resolved.token); const account = available.find((item) => item.id === input.accountId);
    if (!account) throw new MeldError({ code: "FORBIDDEN", message: "The selected Cloudflare account is not available to this connection.", status: 403 });
    await db.update(providerConnections).set({ externalAccountId: account.id, externalAccountName: account.name, state: "connected", updatedAt: new Date() }).where(eq(providerConnections.id, resolved.connection.id));
    return Response.json({ data: account }, { headers: { "x-request-id": id } });
  } catch (error) { return errorResponse(error, id); }
}
