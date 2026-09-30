import { MeldError } from "@melddb/core";
import { z } from "zod";
import { authenticateApiKey, executeUnified } from "@/lib/gateway";
import { errorResponse, requestId } from "@/lib/http";
import { consumeRateLimit } from "@/lib/rate-limit";

const queryInput = z.object({
  sql: z.string().min(1).max(100_000),
  params: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).max(100).default([]),
  routingKey: z.union([z.string(), z.number(), z.boolean()]).optional(),
  confirmDestructive: z.boolean().default(false),
});

type RouteContext = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const id = requestId(request);
  try {
    const { projectId } = await context.params;
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      throw new MeldError({ code: "AUTHENTICATION_REQUIRED", message: "Provide a MeldDB API key as a Bearer token.", status: 401 });
    }
    const secret = authorization.slice("Bearer ".length);
    const limit = consumeRateLimit(`${projectId}:${secret.slice(0, 20)}`);
    if (!limit.allowed) throw new MeldError({ code: "RATE_LIMITED", message: "Project API rate limit exceeded.", status: 429, retryable: true });
    const key = await authenticateApiKey(secret, projectId);
    const input = queryInput.parse(await request.json());
    const result = await executeUnified({ projectId, apiKeyId: key.id, requestId: id, ...input });
    return Response.json({ data: result.rows, meta: { ...result, rows: undefined, requestId: id } }, { headers: { "x-request-id": id, "x-ratelimit-remaining": String(limit.remaining) } });
  } catch (error) {
    return errorResponse(error, id);
  }
}
