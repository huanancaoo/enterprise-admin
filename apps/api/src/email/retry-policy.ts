export function nextEmailAttemptDelayMs(
  failedAttempts: number,
  baseDelayMs: number,
): number {
  const exponential = baseDelayMs * 2 ** Math.max(failedAttempts - 1, 0);
  const jitter = Math.floor(Math.random() * baseDelayMs);
  return exponential + jitter;
}
