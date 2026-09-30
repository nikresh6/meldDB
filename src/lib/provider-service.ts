import { and, desc, eq } from "drizzle-orm";
import { decryptSecret, MeldError, type DatabaseProviderAdapter, type ProviderId } from "@melddb/core";
import { CloudflareD1Adapter, NeonAdapter, SupabaseAdapter } from "@melddb/providers";
import { db } from "@/db";
import { credentialRecords, providerConnections, projects } from "@/db/schema";

function encryptionKey(): string {
  const key = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!key) throw new MeldError({ code: "CONFIGURATION_REQUIRED", message: "Provider encryption is not configured.", status: 503 });
  return key;
}

export async function decryptedCredential(connectionId: string, kind: string): Promise<string | null> {
  const rows = await db
    .select()
    .from(credentialRecords)
    .where(and(eq(credentialRecords.connectionId, connectionId), eq(credentialRecords.kind, kind)))
    .orderBy(desc(credentialRecords.createdAt))
    .limit(1);
  const record = rows[0];
  if (!record) return null;
  return decryptSecret(
    {
      algorithm: "aes-256-gcm",
      version: record.keyVersion,
      ciphertext: record.ciphertext,
      iv: record.iv,
      authTag: record.authTag,
    },
    encryptionKey(),
  );
}

export async function providerAdapterForProject(
  projectId: string,
  provider: ProviderId,
  resourceExternalId?: string,
): Promise<{ adapter: DatabaseProviderAdapter; connection: typeof providerConnections.$inferSelect }> {
  const rows = await db
    .select({ connection: providerConnections })
    .from(projects)
    .innerJoin(providerConnections, eq(projects.workspaceId, providerConnections.workspaceId))
    .where(and(eq(projects.id, projectId), eq(providerConnections.provider, provider)))
    .limit(1);
  const connection = rows[0]?.connection;
  if (!connection || connection.state === "disconnected" || connection.state === "revoked") {
    throw new MeldError({ code: "NOT_FOUND", message: `${provider} is not connected to this workspace.`, status: 404 });
  }
  const tokenKind = provider === "neon" ? "api_key" : "oauth_access_token";
  const token = await decryptedCredential(connection.id, tokenKind);
  if (!token) throw new MeldError({ code: "CREDENTIALS_EXPIRED", message: `Reconnect ${provider}; no active credential is available.`, status: 401 });

  if (provider === "supabase") return { adapter: new SupabaseAdapter(token), connection };
  if (provider === "cloudflare-d1") {
    if (!connection.externalAccountId) {
      throw new MeldError({
        code: "CONFIGURATION_REQUIRED",
        message: "Select the Cloudflare account MeldDB should use before managing D1 databases.",
        status: 409,
      });
    }
    return { adapter: new CloudflareD1Adapter(token, connection.externalAccountId), connection };
  }
  const dataConnection = resourceExternalId
    ? await decryptedCredential(connection.id, `resource:${resourceExternalId}:connection_uri`)
    : undefined;
  return { adapter: new NeonAdapter(token, undefined, dataConnection ?? undefined), connection };
}
