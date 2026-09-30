import { createHmac } from "node:crypto";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { appUrl, trustedAppOrigins } from "@/lib/app-url";

const isBuild = process.env.NEXT_PHASE === "phase-production-build";

function authSecret(): string | undefined {
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET;

  const credentialKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (credentialKey) {
    return createHmac("sha256", credentialKey)
      .update("melddb-better-auth-v1")
      .digest("base64url");
  }

  return isBuild ? "melddb-build-only-secret-not-used-at-runtime" : undefined;
}

export const auth = betterAuth({
  appName: "MeldDB",
  baseURL: appUrl(),
  secret: authSecret(),
  trustedOrigins: trustedAppOrigins(),
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
    transaction: true,
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
  advanced: {
    database: { joins: true },
    cookiePrefix: "melddb",
    useSecureCookies: process.env.NODE_ENV === "production",
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 20,
  },
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
