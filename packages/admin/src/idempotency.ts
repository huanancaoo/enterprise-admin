export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key"

export type IdempotencyAttempt = {
  key: string
}

// 同一指纹重试沿用原键。未知结果不能在这里清键；调用方只在确认成功后丢掉 attempt。
export function nextIdempotencyAttempt<T extends IdempotencyAttempt>(
  current: T | null,
  sameAttempt: boolean,
  create: (key: string) => T,
): T {
  if (current && sameAttempt) return current
  return create(crypto.randomUUID())
}
