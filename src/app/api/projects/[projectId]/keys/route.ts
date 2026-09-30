import { and, eq, isNull } from "drizzle-orm";
import { generateApiKey, MeldError } from "@melddb/core";
import { z } from "zod";
import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { requireProjectAccess } from "@/lib/authorization";
import { errorResponse, requestId } from "@/lib/http";

const keyInput = z.object({ name: z.string().trim().min(2).max(120) });

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const id = requestId(request);
  try {
    const { projectId } = await context.params;
    await requireProjectAccess(projectId, "viewer", request.headers);
    const rows = await db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
        revokedAt: apiKeys.revokedAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.projectId, projectId));
    return Response.json({ data: rows }, { headers: { "x-request-id": id } });
  } catch (error) {
    return errorResponse(error, id);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const id = requestId(request);
  try {
    const { projectId } = await context.params;
    await requireProjectAccess(projectId, "admin", request.headers);
    const input = keyInput.parse(await request.json());
    const pepper = process.env.CREDENTIAL_ENCRYPTION_KEY;
    if (!pepper) throw new MeldError({ code: "CONFIGURATION_REQUIRED", message: "API key hashing is not configured.", status: 503 });
    const generated = generateApiKey(pepper);
    const row = (
      await db
        .insert(apiKeys)
        .values({ projectId, name: input.name, prefix: generated.prefix, secretHash: generated.hash })
        .returning({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, createdAt: apiKeys.createdAt })
    )[0];
    return Response.json({ data: row, secret: generated.secret }, { status: 201, headers: { "x-request-id": id } });
  } catch (error) {
    return errorResponse(error, id);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const id = requestId(request);
  try {
    const { projectId } = await context.params;
    await requireProjectAccess(projectId, "admin", request.headers);
    const keyId = new URL(request.url).searchParams.get("keyId");
    if (!keyId) throw new MeldError({ code: "INVALID_INPUT", message: "keyId is required.", status: 400 });
    const rows = await db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.projectId, projectId), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id });
    if (rows.length === 0) throw new MeldError({ code: "NOT_FOUND", message: "Active API key not found.", status: 404 });
    return Response.json({ revoked: true }, { headers: { "x-request-id": id } });
  } catch (error) {
    return errorResponse(error, id);
  }
}
