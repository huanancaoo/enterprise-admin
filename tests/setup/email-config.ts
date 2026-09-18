export function testEmailConfig(overrides = {}) {
  return {
    smtp: { host: "127.0.0.1", port: 1025, secure: false },
    from: { email: "noreply@example.test", name: "Enterprise Admin" },
    encryptionKey: Buffer.alloc(32, 7),
    linkOrigin: "http://localhost:3200",
    defaultLocale: "zh-CN" as const,
    pollIntervalMs: 50,
    retry: { maxAttempts: 5, baseDelayMs: 50 },
    messageTtlMs: 86_400_000,
    ...overrides,
  }
}
