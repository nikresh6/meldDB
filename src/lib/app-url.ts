function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function vercelUrl(value: string | undefined): string | null {
  return value ? `https://${value}` : null;
}

export function appUrl(): string {
  const explicit = process.env.APP_URL ?? process.env.BETTER_AUTH_URL;
  if (explicit) return normalizeUrl(explicit);

  return normalizeUrl(
    vercelUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
      vercelUrl(process.env.VERCEL_URL) ??
      "http://localhost:3000",
  );
}

export function trustedAppOrigins(): string[] {
  const origins = new Set<string>([appUrl()]);

  const current = vercelUrl(process.env.VERCEL_URL);
  const branch = vercelUrl(process.env.VERCEL_BRANCH_URL);
  if (current) origins.add(normalizeUrl(current));
  if (branch) origins.add(normalizeUrl(branch));
  if (process.env.NODE_ENV !== "production") origins.add("http://localhost:3000");

  return [...origins];
}

export function oauthRedirectUri(provider: "supabase" | "cloudflare"): string {
  const explicit =
    provider === "supabase"
      ? process.env.SUPABASE_OAUTH_REDIRECT_URI
      : process.env.CLOUDFLARE_OAUTH_REDIRECT_URI;

  if (explicit) return explicit;

  return `${appUrl()}/api/providers/${provider}/callback`;
}
