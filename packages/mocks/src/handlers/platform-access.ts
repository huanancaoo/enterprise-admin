export function createPlatformAccessFixture(userId: string, auditor = false) {
  const readable = [
    "organization",
    "user",
    "audit",
    "settings",
    "login",
    "session",
  ].map((resource) => `platform.${resource}:read`)
  return {
    userId,
    roles: [
      {
        id: "a6000000-0000-4000-8000-000000000001",
        key: auditor ? "platform_auditor" : "platform_admin",
        name: auditor ? "Platform auditor" : "Platform administrator",
        builtIn: true,
      },
    ],
    permissions: auditor
      ? readable
      : [
          ...readable,
          "platform.organization:update",
          "platform.user:create",
          "platform.user:update",
          "platform.user:suspend",
          "platform.user:resetPassword",
          "platform.user:readSensitive",
          "platform.user:unlock",
          "platform.settings:update",
          "platform.session:revoke",
        ],
    scope: "global" as const,
    mfaVerifiedAt: "2026-10-02T00:00:00.000Z",
  }
}
