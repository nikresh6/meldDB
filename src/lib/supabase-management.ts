import { MeldError, normalizeProviderError } from "@melddb/core";
import { decryptedCredential } from "@/lib/provider-service";

const API = "https://api.supabase.com";

export async function supabaseManagementRequest<T>(connectionId: string, path: string, init: RequestInit = {}): Promise<T> {
  const token = await decryptedCredential(connectionId, "oauth_access_token");
  if (!token) throw new MeldError({ code: "CREDENTIALS_EXPIRED", message: "Reconnect Supabase to continue.", status: 401 });
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...init.headers },
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
  } catch {
    throw new MeldError({ code: "PROVIDER_UNREACHABLE", message: "Supabase is temporarily unreachable. Other connected providers remain available.", provider: "supabase", retryable: true, status: 503 });
  }
  const requestId = response.headers.get("x-request-id") ?? undefined;
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    const message = typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "Supabase rejected the management request.";
    throw normalizeProviderError("supabase", response.status, message, requestId);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

const secretPattern = /(secret|password|smtp_pass|client_secret|jwt_secret|api_key|token)/i;
export function redactConfig(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactConfig);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, secretPattern.test(key) && item ? "••••••••" : redactConfig(item)]));
}
