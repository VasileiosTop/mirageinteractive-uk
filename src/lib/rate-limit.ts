// Fixed-window KV-based rate limiter. Coarser than a sliding window, but
// trivial to reason about and adequate for low-traffic form endpoints.

export interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number; // seconds
}

export async function consumeRateLimit(
  kv: KVNamespace,
  identifier: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const window = Math.floor(now / windowSeconds);
  const key = `rl:${identifier}:${window}`;
  const currentRaw = await kv.get(key);
  const current = currentRaw ? parseInt(currentRaw, 10) : 0;
  if (current >= limit) {
    const nextWindowStart = (window + 1) * windowSeconds;
    return { allowed: false, retryAfter: Math.max(1, nextWindowStart - now) };
  }
  // Best-effort increment. Race conditions can let the count drift by a small
  // amount under contention; for a low-traffic waitlist that's acceptable.
  await kv.put(key, String(current + 1), { expirationTtl: windowSeconds * 2 });
  return { allowed: true };
}
