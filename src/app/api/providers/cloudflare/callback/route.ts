import { MeldError } from "@melddb/core";
import { requireSession } from "@/lib/authorization";
import { errorResponse, requestId } from "@/lib/http";
import { consumeOAuthAttempt, exchangeAuthorizationCode, persistProviderTokens } from "@/lib/provider-oauth";
import { oauthRedirectUri } from "@/lib/app-url";

export async function GET(request: Request) {
  const id = requestId(request);
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) throw new MeldError({ code: "INVALID_INPUT", message: "Cloudflare did not return a valid authorization response.", status: 400 });
    const session = await requireSession(request.headers);
    const attempt = await consumeOAuthAttempt(state, "cloudflare-d1", session.user.id);
    const clientId = process.env.CLOUDFLARE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.CLOUDFLARE_OAUTH_CLIENT_SECRET;
    const redirectUri = oauthRedirectUri("cloudflare");
    if (!clientId || !clientSecret) throw new MeldError({ code: "CONFIGURATION_REQUIRED", message: "Cloudflare OAuth is not configured.", status: 503 });
    const tokens = await exchangeAuthorizationCode({
      tokenUrl: "https://dash.cloudflare.com/oauth2/token",
      clientId,
      clientSecret,
      code,
      codeVerifier: attempt.codeVerifier,
      redirectUri,
    });
    if (typeof tokens.access_token !== "string") throw new MeldError({ code: "PROVIDER_ERROR", message: "Cloudflare did not issue an access token.", status: 502 });

    const accountsResponse = await fetch("https://api.cloudflare.com/client/v4/accounts?per_page=50", {
      headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    const accountsBody = (await accountsResponse.json().catch(() => ({}))) as Record<string, unknown>;
    const accounts = Array.isArray(accountsBody.result) ? accountsBody.result : [];
    const account = accounts.length === 1 && typeof accounts[0] === "object" && accounts[0] !== null ? (accounts[0] as Record<string, unknown>) : null;
    await persistProviderTokens({
      provider: "cloudflare-d1",
      workspaceId: attempt.workspaceId,
      externalAccountId: account && typeof account.id === "string" ? account.id : null,
      externalAccountName: account && typeof account.name === "string" ? account.name : accounts.length > 1 ? "Account selection required" : null,
      scopes: typeof tokens.scope === "string" ? tokens.scope.split(" ") : [],
      accessToken: tokens.access_token,
      refreshToken: typeof tokens.refresh_token === "string" ? tokens.refresh_token : undefined,
      expiresAt: typeof tokens.expires_in === "number" ? new Date(Date.now() + tokens.expires_in * 1000) : undefined,
    });
    const selection = accounts.length > 1 ? "&accountSelection=required" : "";
    return Response.redirect(new URL(`${attempt.redirectPath}?provider=cloudflare&connected=1${selection}`, url.origin));
  } catch (error) {
    return errorResponse(error, id);
  }
}
