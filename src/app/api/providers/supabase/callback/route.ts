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
    if (!code || !state) throw new MeldError({ code: "INVALID_INPUT", message: "Supabase did not return a valid authorization response.", status: 400 });
    const session = await requireSession(request.headers);
    const attempt = await consumeOAuthAttempt(state, "supabase", session.user.id);
    const clientId = process.env.SUPABASE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.SUPABASE_OAUTH_CLIENT_SECRET;
    const redirectUri = oauthRedirectUri("supabase");
    if (!clientId || !clientSecret) throw new MeldError({ code: "CONFIGURATION_REQUIRED", message: "Supabase OAuth is not configured.", status: 503 });
    const tokens = await exchangeAuthorizationCode({
      tokenUrl: "https://api.supabase.com/v1/oauth/token",
      clientId,
      clientSecret,
      code,
      codeVerifier: attempt.codeVerifier,
      redirectUri,
    });
    if (typeof tokens.access_token !== "string") throw new MeldError({ code: "PROVIDER_ERROR", message: "Supabase did not issue an access token.", status: 502 });
    await persistProviderTokens({
      provider: "supabase",
      workspaceId: attempt.workspaceId,
      externalAccountId: typeof tokens.user_id === "string" ? tokens.user_id : null,
      externalAccountName: null,
      scopes: typeof tokens.scope === "string" ? tokens.scope.split(" ") : [],
      accessToken: tokens.access_token,
      refreshToken: typeof tokens.refresh_token === "string" ? tokens.refresh_token : undefined,
      expiresAt: typeof tokens.expires_in === "number" ? new Date(Date.now() + tokens.expires_in * 1000) : undefined,
    });
    return Response.redirect(new URL(`${attempt.redirectPath}?provider=supabase&connected=1`, url.origin));
  } catch (error) {
    return errorResponse(error, id);
  }
}
