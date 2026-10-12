import { http, HttpResponse } from "msw"

function failure(status: 403 | 500) {
  const code = status === 403 ? "FORBIDDEN" : "INTERNAL_ERROR"
  return HttpResponse.json(
    {
      code,
      message: code,
      requestId: "storybook-credentials",
      locale: "en-US",
    },
    { status }
  )
}

export const accessCredentialOrganizationId =
  "c1c1c1c1-1111-4111-8111-c1c1c1c1c1c1"
const metadata = {
  id: "c2c2c2c2-1111-4111-8111-c2c2c2c2c2c2",
  organizationId: accessCredentialOrganizationId,
  userId: "c3c3c3c3-1111-4111-8111-c3c3c3c3c3c3",
  name: "Accounting bridge",
  expiresAt: "2030-01-01T00:00:00.000Z",
  createdAt: "2026-10-11T00:00:00.000Z",
  enabled: true,
  permissions: { project: ["read"] },
}
export const accessCredentialUser = {
  id: metadata.userId,
  name: "Credential owner",
  email: "credential-owner@example.test",
  image: null,
}
export const otherAccessCredentialUser = {
  ...accessCredentialUser,
  id: "c4c4c4c4-1111-4111-8111-c4c4c4c4c4c4",
  name: "Second account",
  email: "second-account@example.test",
}
export function createAccessCredentialsScenario(
  state:
    | "empty"
    | "paginated"
    | "populated"
    | "create-error"
    | "read-only"
    | "forbidden"
    | "load-error" = "empty"
) {
  let created = state === "populated" || state === "read-only"
  let enabled = true
  let otherAccount = false
  let metadataDenied = false
  const handlers = [
    http.get("*/api/v1/organizations/:organizationId/access", () =>
      state === "forbidden"
        ? failure(403)
        : HttpResponse.json({
            organizationId: accessCredentialOrganizationId,
            status: "ACTIVE",
            authorizationVersion: 1,
            effectiveLocale: "en-US",
            effectiveLocaleSource: "organization",
          })
    ),
    http.get("*/api/v1/organizations/:organizationId/role-access", () =>
      state === "forbidden"
        ? failure(403)
        : HttpResponse.json({
            canRead: true,
            canCreate: true,
            canUpdate: true,
            canDelete: true,
            grantablePermissions: [
              {
                resource: "integration",
                action: state === "read-only" ? "read" : "manage",
              },
              { resource: "project", action: "read" },
            ],
          })
    ),
    http.get(
      "*/api/v1/organizations/:organizationId/access-credentials",
      ({ request }) => {
        if (metadataDenied) return failure(403)
        if (state === "forbidden" || state === "load-error")
          return failure(state === "forbidden" ? 403 : 500)
        const query = new URL(request.url).searchParams
        const page = Number(query.get("page") ?? 1)
        const pageSize = Number(query.get("pageSize") ?? 20)
        const records =
          state === "paginated"
            ? Array.from({ length: 21 }, (_, index) => ({
                ...metadata,
                id: `c2c2c2c2-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
                name: `Accounting bridge ${index + 1}`,
              }))
            : created
              ? [
                  {
                    ...metadata,
                    enabled,
                    ...(otherAccount
                      ? {
                          userId: otherAccessCredentialUser.id,
                          name: "Second account integration",
                        }
                      : {}),
                  },
                ]
              : []
        return HttpResponse.json({
          items: records.slice((page - 1) * pageSize, page * pageSize),
          page,
          pageSize,
          total: records.length,
        })
      }
    ),
    http.post(
      "*/api/v1/organizations/:organizationId/access-credentials",
      async ({ request }) => {
        if (state === "create-error") return failure(500)
        const input = (await request.json()) as { name: string }
        created = true
        return HttpResponse.json(
          {
            ...metadata,
            name: input.name,
            key: "ea_story_fixture_not_a_real_key",
          },
          { status: 201 }
        )
      }
    ),
    http.delete(
      "*/api/v1/organizations/:organizationId/access-credentials/:credentialId",
      () => {
        enabled = false
        return new HttpResponse(null, { status: 204 })
      }
    ),
  ]

  return {
    handlers,
    denyMetadata: () => {
      metadataDenied = true
    },
    switchAccount: () => {
      otherAccount = true
    },
    reset: () => {
      created = state === "populated" || state === "read-only"
      enabled = true
      otherAccount = false
      metadataDenied = false
    },
  }
}
