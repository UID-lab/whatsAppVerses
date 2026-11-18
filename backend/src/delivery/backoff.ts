/** Exponential backoff with full jitter: 30s, 1m, 2m, 4m … capped at 1h. */
export function retryDelayMs(attempt: number, baseMs = 30_000, maxMs = 3_600_000, random = Math.random): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp / 2 + random() * (exp / 2));
}
