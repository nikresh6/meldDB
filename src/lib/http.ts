import { randomUUID } from "node:crypto";
import { MeldError } from "@melddb/core";

export function requestId(request: Request): string {
  return request.headers.get("x-request-id")?.slice(0, 80) || randomUUID();
}

export function errorResponse(error: unknown, id: string): Response {
  if (error instanceof MeldError) {
    return Response.json(
      { error: { code: error.code, message: error.message, requestId: error.requestId ?? id, retryable: error.retryable } },
      { status: error.status, headers: { "x-request-id": id } },
    );
  }
  return Response.json(
    { error: { code: "INTERNAL_ERROR", message: "The request could not be completed.", requestId: id } },
    { status: 500, headers: { "x-request-id": id } },
  );
}
