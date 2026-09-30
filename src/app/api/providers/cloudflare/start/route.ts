import { MeldError } from "@melddb/core";
import { requireWorkspaceAccess } from "@/lib/authorization";
import { errorResponse, requestId } from "@/lib/http";
import { createOAuthAttempt } from "@/lib/provider-oauth";

export async function GET(request: Request) {
  const id = requestId(request);
  try {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId");
    if (!workspaceId) throw new MeldError({ code: "INVALID_INPUT", message: "workspaceId is required.", status: 400 });
    const clientId = process.env.CLOUDFLARE_OAUTH_CLIENT_ID;
    const redirectUri = process.env.CLOUDFLARE_OAUTH_REDIRECT_URI;
    if (!clientId || !process.env.CLOUDFLARE_OAUTH_CLIENT_SECRET || !redirectUri) {
      throw new MeldError({ code: "CONFIGURATION_REQUIRED", message: "Cloudflare OAuth owner credentials are not configured.", status: 503 });
    }
    const { session } = await requireWorkspaceAccess(workspaceId, "admin", request.headers);
    const attempt = await createOAuthAttempt({
      provider: "cloudflare-d1",
      workspaceId,
      userId: session.user.id,
      redirectPath: url.searchParams.get("returnTo") ?? "/app",
    });
    const authorize = new URL("https://dash.cloudflare.com/oauth2/auth");
    authorize.searchParams.set("client_id", clientId);
    authorize.searchParams.set("redirect_uri", redirectUri);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("state", attempt.state);
    authorize.searchParams.set("code_challenge", attempt.codeChallenge);
    authorize.searchParams.set("code_challenge_method", "S256");
    return Response.redirect(authorize);
  } catch (error) {
    return errorResponse(error, id);
  }
}
