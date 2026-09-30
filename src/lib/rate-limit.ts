interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

export function consumeRateLimit(
  key: string,
  options: { max?: number; windowSeconds?: number } = {},
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const max = options.max ?? Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? "120");
  const windowMs = (options.windowSeconds ?? Number(process.env.RATE_LIMIT_WINDOW_SECONDS ?? "60")) * 1000;
  const current = buckets.get(key);
  const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
  bucket.count += 1;
  buckets.set(key, bucket);

  if (buckets.size > MAX_BUCKETS) {
    for (const [bucketKey, value] of buckets) {
      if (value.resetAt <= now) buckets.delete(bucketKey);
      if (buckets.size <= MAX_BUCKETS) break;
    }
  }

  return { allowed: bucket.count <= max, remaining: Math.max(0, max - bucket.count), resetAt: bucket.resetAt };
}
