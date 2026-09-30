import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface GeneratedApiKey {
  secret: string;
  prefix: string;
  hash: string;
}

export function hashApiKey(secret: string, pepper: string): string {
  return createHmac("sha256", pepper).update(secret, "utf8").digest("base64url");
}

export function generateApiKey(pepper: string, environment: "live" | "test" = "live"): GeneratedApiKey {
  const prefix = `mdb_${environment}_`;
  const secret = `${prefix}${randomBytes(32).toString("base64url")}`;
  return { secret, prefix: secret.slice(0, prefix.length + 8), hash: hashApiKey(secret, pepper) };
}

export function verifyApiKey(secret: string, expectedHash: string, pepper: string): boolean {
  const actual = Buffer.from(hashApiKey(secret, pepper));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
