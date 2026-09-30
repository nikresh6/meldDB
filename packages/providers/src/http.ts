import { MeldError, normalizeProviderError, type ProviderId } from "@melddb/core";

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function asRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

export function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export interface ProviderFetchOptions extends RequestInit {
  provider: ProviderId;
  token: string;
  fallbackMessage: string;
}

export async function providerFetch<T = unknown>(url: string, options: ProviderFetchOptions): Promise<T> {
  const { provider, token, fallbackMessage, headers, ...init } = options;
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...headers,
      },
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
  } catch {
    throw new MeldError({
      code: "PROVIDER_UNREACHABLE",
      message: `${provider === "cloudflare-d1" ? "Cloudflare" : provider} is temporarily unreachable. Other connected providers remain available.`,
      provider,
      retryable: true,
      status: 503,
    });
  }

  const requestId = response.headers.get("cf-ray") ?? response.headers.get("x-request-id") ?? undefined;
  const body = (await response.json().catch(() => null)) as T;
  if (!response.ok) {
    const record = asRecord(body);
    const errors = Array.isArray(record.errors) ? record.errors.map(asRecord) : [];
    const providerMessage =
      stringValue(record.message) ?? stringValue(record.error) ?? stringValue(errors[0]?.message) ?? fallbackMessage;
    throw normalizeProviderError(provider, response.status, providerMessage, requestId);
  }

  return body;
}

export function quoteIdentifier(identifier: string): string {
  if (identifier.length === 0 || identifier.length > 128 || identifier.includes("\0")) {
    throw new MeldError({ code: "INVALID_INPUT", message: "Invalid SQL identifier.", status: 400 });
  }
  return `"${identifier.replaceAll('"', '""')}"`;
}
