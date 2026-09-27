import { describe, expect, it } from "vitest"
import { isOrganizationRolesPath } from "../../apps/tenant/src/lib/organization-route"

describe("Organization admin route matching", () => {
  it.each([
    ["/app/organizations/org-123/roles", true],
    ["/app/organizations/org-123/roles/", true],
    ["/app/organizations/org-123/settings", false],
    ["/app/organizations/org-123/audit", false],
    ["/app/organizations/org-123/roles-extra", false],
  ])("matches %s as roles page: %s", (pathname, expected) => {
    expect(isOrganizationRolesPath(pathname)).toBe(expected)
  })
})
