import type { ProviderId } from "./provider";

export type MeldErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "QUOTA_FULL"
  | "CREDENTIALS_EXPIRED"
  | "PERMISSION_MISSING"
  | "PROVIDER_UNREACHABLE"
  | "PROVIDER_ERROR"
  | "UNSUPPORTED"
  | "UNSUPPORTED_SQL"
  | "RATE_LIMITED"
  | "CONFIGURATION_REQUIRED";

export interface MeldErrorOptions {
  code: MeldErrorCode;
  message: string;
  requestId?: string;
  provider?: ProviderId;
  status?: number;
  retryable?: boolean;
  safeDetails?: Record<string, string | number | boolean | null>;
}

export class MeldError extends Error {
  readonly code: MeldErrorCode;
  readonly requestId?: string;
  readonly provider?: ProviderId;
  readonly status: number;
  readonly retryable: boolean;
  readonly safeDetails?: Record<string, string | number | boolean | null>;

  constructor(options: MeldErrorOptions) {
    super(options.message);
    this.name = "MeldError";
    this.code = options.code;
    this.requestId = options.requestId;
    this.provider = options.provider;
    this.status = options.status ?? 500;
    this.retryable = options.retryable ?? false;
    this.safeDetails = options.safeDetails;
  }
}

export function normalizeProviderError(
  provider: ProviderId,
  status: number,
  fallbackMessage: string,
  requestId?: string,
): MeldError {
  if (status === 401) {
    return new MeldError({
      code: "CREDENTIALS_EXPIRED",
      message: `Reconnect ${provider === "cloudflare-d1" ? "Cloudflare" : provider}. The saved credential is no longer accepted.`,
      provider,
      requestId,
      status,
    });
  }

  if (status === 403) {
    return new MeldError({
      code: "PERMISSION_MISSING",
      message: `${provider === "cloudflare-d1" ? "Cloudflare" : provider} did not grant the permission required for this action.`,
      provider,
      requestId,
      status,
    });
  }

  if (status === 409 || status === 422) {
    return new MeldError({
      code: "QUOTA_FULL",
      message: fallbackMessage,
      provider,
      requestId,
      status,
    });
  }

  if (status === 429) {
    return new MeldError({
      code: "RATE_LIMITED",
      message: `${provider === "cloudflare-d1" ? "Cloudflare" : provider} is rate limiting this request. Retry after the provider window resets.`,
      provider,
      requestId,
      status,
      retryable: true,
    });
  }

  if (status >= 500) {
    return new MeldError({
      code: "PROVIDER_UNREACHABLE",
      message: `${provider === "cloudflare-d1" ? "Cloudflare" : provider} is temporarily unreachable. Other connected providers remain available.`,
      provider,
      requestId,
      status,
      retryable: true,
    });
  }

  return new MeldError({
    code: "PROVIDER_ERROR",
    message: fallbackMessage,
    provider,
    requestId,
    status,
  });
}
