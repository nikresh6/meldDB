import type { ProviderCapacity, ProviderId } from "./provider";

const MB = 1024 * 1024;
const GB = 1024 * MB;

export interface ProviderFallbackLimit {
  provider: ProviderId;
  plan: string;
  resourceType: "project" | "database";
  resourceLimit: number;
  storagePerResourceBytes: number;
  accountStorageLimitBytes: number | null;
  verifiedAt: string;
  sourceUrl: string;
}

export const providerFallbackLimits: Record<ProviderId, ProviderFallbackLimit> = {
  supabase: {
    provider: "supabase",
    plan: "Free",
    resourceType: "project",
    resourceLimit: 2,
    storagePerResourceBytes: 500 * MB,
    accountStorageLimitBytes: null,
    verifiedAt: "2026-09-30",
    sourceUrl: "https://supabase.com/pricing",
  },
  neon: {
    provider: "neon",
    plan: "Free",
    resourceType: "project",
    resourceLimit: 20,
    storagePerResourceBytes: 0.5 * GB,
    accountStorageLimitBytes: 10 * GB,
    verifiedAt: "2026-09-30",
    sourceUrl: "https://neon.com/pricing",
  },
  "cloudflare-d1": {
    provider: "cloudflare-d1",
    plan: "Workers Free",
    resourceType: "database",
    resourceLimit: 10,
    storagePerResourceBytes: 500 * MB,
    accountStorageLimitBytes: 5 * GB,
    verifiedAt: "2026-09-30",
    sourceUrl: "https://developers.cloudflare.com/d1/platform/limits/",
  },
};

export function capacityFromFallback(provider: ProviderId, used: number | null): ProviderCapacity {
  const fallback = providerFallbackLimits[provider];
  const remaining = used === null ? null : Math.max(0, fallback.resourceLimit - used);

  return {
    provider,
    plan: fallback.plan,
    resourceType: fallback.resourceType,
    knownFreeResourceLimit: fallback.resourceLimit,
    actualResourcesUsed: used,
    actualResourcesRemaining: remaining,
    storagePerResourceBytes: fallback.storagePerResourceBytes,
    accountStorageLimitBytes: fallback.accountStorageLimitBytes,
    accountStorageUsedBytes: null,
    canCreateResource: remaining === null ? true : remaining > 0,
    unavailableReason: remaining === 0 ? `${fallback.plan} ${fallback.resourceType} capacity reached` : undefined,
    lastCheckedAt: new Date().toISOString(),
    source: "known_limit",
  };
}

export function normalizeCapacity(input: ProviderCapacity): ProviderCapacity {
  const remaining =
    input.actualResourcesRemaining ??
    (input.knownFreeResourceLimit !== null && input.actualResourcesUsed !== null
      ? Math.max(0, input.knownFreeResourceLimit - input.actualResourcesUsed)
      : null);

  return {
    ...input,
    actualResourcesRemaining: remaining,
    canCreateResource: input.canCreateResource && remaining !== 0,
    unavailableReason:
      remaining === 0 ? input.unavailableReason ?? "Provider resource capacity reached" : input.unavailableReason,
  };
}

export function logicalStorageSummary(capacities: ProviderCapacity[]): {
  knownLimitBytes: number;
  usedBytes: number;
  unknownProviders: ProviderId[];
} {
  return capacities.reduce(
    (summary, capacity) => {
      if (capacity.accountStorageUsedBytes !== null) summary.usedBytes += capacity.accountStorageUsedBytes;

      if (capacity.storagePerResourceBytes !== null && capacity.actualResourcesUsed !== null) {
        summary.knownLimitBytes += capacity.storagePerResourceBytes * capacity.actualResourcesUsed;
      } else {
        summary.unknownProviders.push(capacity.provider);
      }

      return summary;
    },
    { knownLimitBytes: 0, usedBytes: 0, unknownProviders: [] as ProviderId[] },
  );
}
