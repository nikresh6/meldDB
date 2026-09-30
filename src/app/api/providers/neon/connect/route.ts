import { encryptSecret, MeldError } from "@melddb/core";
import { NeonAdapter } from "@melddb/providers";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { credentialRecords, providerConnections } from "@/db/schema";
import { requireWorkspaceAccess } from "@/lib/authorization";
import { errorResponse, requestId } from "@/lib/http";

const inputSchema = z.object({ workspaceId: z.string().uuid(), apiKey: z.string().min(20).max(500) });

export async function POST(request: Request) {
  const id = requestId(request);
  try {
    const input = inputSchema.parse(await request.json());
    await requireWorkspaceAccess(input.workspaceId, "admin", request.headers);
    const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
    if (!encryptionKey) throw new MeldError({ code: "CONFIGURATION_REQUIRED", message: "Provider encryption is not configured.", status: 503 });

    const adapter = new NeonAdapter(input.apiKey);
    await adapter.validateConnection();
    const encrypted = encryptSecret(input.apiKey, encryptionKey, Number(process.env.CREDENTIAL_ENCRYPTION_KEY_VERSION ?? "1"));
    const connectionId = await db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: providerConnections.id })
        .from(providerConnections)
        .where(and(eq(providerConnections.workspaceId, input.workspaceId), eq(providerConnections.provider, "neon")))
        .limit(1);
      const connection = existing[0]
        ? (
            await tx
              .update(providerConnections)
              .set({ state: "connected", lastErrorCode: null, lastErrorMessage: null, updatedAt: new Date() })
              .where(eq(providerConnections.id, existing[0].id))
              .returning({ id: providerConnections.id })
          )[0]
        : (
            await tx
              .insert(providerConnections)
              .values({ workspaceId: input.workspaceId, provider: "neon", state: "connected" })
              .returning({ id: providerConnections.id })
          )[0];
      if (!connection) throw new Error("Neon connection was not created.");
      await tx.delete(credentialRecords).where(eq(credentialRecords.connectionId, connection.id));
      await tx.insert(credentialRecords).values({
        connectionId: connection.id,
        kind: "api_key",
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        keyVersion: encrypted.version,
      });
      return connection.id;
    });

    return Response.json({ connected: true, connectionId }, { status: 201, headers: { "x-request-id": id } });
  } catch (error) {
    return errorResponse(error, id);
  }
}
