import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { decryptSecret, encryptSecret, MeldError, type ProviderId } from "@melddb/core";
import { db } from "@/db";
import { credentialRecords, oauthStates, providerConnections } from "@/db/schema";

function encryptionConfig(): { key: string; version: number } {
  const key = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!key) throw new MeldError({ code: "CONFIGURATION_REQUIRED", message: "Provider encryption is not configured.", status: 503 });
  return { key, version: Number(process.env.CREDENTIAL_ENCRYPTION_KEY_VERSION ?? "1") };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

export interface OAuthAttempt {
  state: string;
  codeChallenge: string;
}

export async function createOAuthAttempt(input: {
  provider: Extract<ProviderId, "supabase" | "cloudflare-d1">;
  workspaceId: string;
  userId: string;
  redirectPath: string;
}): Promise<OAuthAttempt> {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const { key, version } = encryptionConfig();
  const encrypted = encryptSecret(verifier, key, version);
  await db.insert(oauthStates).values({
    workspaceId: input.workspaceId,
    userId: input.userId,
    provider: input.provider,
    stateHash: sha256(state),
    codeVerifierCiphertext: encrypted.ciphertext,
    codeVerifierIv: encrypted.iv,
    codeVerifierAuthTag: encrypted.authTag,
    redirectPath: input.redirectPath.startsWith("/") ? input.redirectPath : "/app",
    expiresAt: new Date(Date.now() + 10 * 60_000),
  });
  return { state, codeChallenge: sha256(verifier) };
}

export async function consumeOAuthAttempt(state: string, provider: ProviderId, userId: string) {
  const stateHash = sha256(state);
  const rows = await db
    .update(oauthStates)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(oauthStates.stateHash, stateHash),
        eq(oauthStates.provider, provider),
        eq(oauthStates.userId, userId),
        isNull(oauthStates.usedAt),
        gt(oauthStates.expiresAt, new Date()),
      ),
    )
    .returning();
  const attempt = rows[0];
  if (!attempt) {
    throw new MeldError({ code: "FORBIDDEN", message: "This provider authorization attempt is invalid or expired.", status: 403 });
  }
  const { key, version } = encryptionConfig();
  return {
    ...attempt,
    codeVerifier: decryptSecret(
      {
        algorithm: "aes-256-gcm",
        version,
        ciphertext: attempt.codeVerifierCiphertext,
        iv: attempt.codeVerifierIv,
        authTag: attempt.codeVerifierAuthTag,
      },
      key,
    ),
  };
}

export async function persistProviderTokens(input: {
  provider: Extract<ProviderId, "supabase" | "cloudflare-d1">;
  workspaceId: string;
  externalAccountId: string | null;
  externalAccountName: string | null;
  scopes: string[];
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
}): Promise<string> {
  const { key, version } = encryptionConfig();
  const access = encryptSecret(input.accessToken, key, version);
  const refresh = input.refreshToken ? encryptSecret(input.refreshToken, key, version) : null;

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: providerConnections.id })
      .from(providerConnections)
      .where(and(eq(providerConnections.workspaceId, input.workspaceId), eq(providerConnections.provider, input.provider)))
      .limit(1);
    const existingId = existing[0]?.id;
    const connection = existingId
      ? (
          await tx
            .update(providerConnections)
            .set({
              externalAccountId: input.externalAccountId,
              externalAccountName: input.externalAccountName,
              state: "connected",
              grantedScopes: input.scopes,
              lastErrorCode: null,
              lastErrorMessage: null,
              updatedAt: new Date(),
            })
            .where(eq(providerConnections.id, existingId))
            .returning({ id: providerConnections.id })
        )[0]
      : (
          await tx
            .insert(providerConnections)
            .values({
              workspaceId: input.workspaceId,
              provider: input.provider,
              externalAccountId: input.externalAccountId,
              externalAccountName: input.externalAccountName,
              state: "connected",
              grantedScopes: input.scopes,
            })
            .returning({ id: providerConnections.id })
        )[0];
    if (!connection) throw new Error("Provider connection was not persisted.");

    await tx.delete(credentialRecords).where(eq(credentialRecords.connectionId, connection.id));
    await tx.insert(credentialRecords).values({
      connectionId: connection.id,
      kind: "oauth_access_token",
      ciphertext: access.ciphertext,
      iv: access.iv,
      authTag: access.authTag,
      keyVersion: access.version,
      expiresAt: input.expiresAt,
    });
    if (refresh) {
      await tx.insert(credentialRecords).values({
        connectionId: connection.id,
        kind: "oauth_refresh_token",
        ciphertext: refresh.ciphertext,
        iv: refresh.iv,
        authTag: refresh.authTag,
        keyVersion: refresh.version,
      });
    }
    return connection.id;
  });
}

export async function exchangeAuthorizationCode(input: {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<Record<string, unknown>> {
  const response = await fetch(input.tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`, "utf8").toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new MeldError({
      code: "PROVIDER_ERROR",
      message: typeof body.error_description === "string" ? body.error_description : "The provider rejected the authorization code.",
      status: 502,
    });
  }
  return body;
}
