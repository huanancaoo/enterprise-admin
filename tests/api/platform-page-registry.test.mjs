import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { startTestApplication } from "../setup/test-runtime.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { platformPages } from "../../apps/platform/src/features/system/platform-pages.ts"

describe("platform page registration across code and database", () => {
  const origin = "http://localhost:3201"
  let environment, actor
  beforeAll(async () => {
    environment = await startTestApplication({ origins: [origin] })
    actor = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    await environment.observer.query(
      "INSERT INTO platform_assignment(user_id,status,version,granted_at,granted_by,grant_reason) VALUES($1,'active',1,clock_timestamp(),'registry-test','Page registry test')",
      [actor.user.id]
    )
    await environment.observer.query(
      "INSERT INTO platform_assignment_role(user_id,role_id) SELECT $1,id FROM platform_role WHERE key='platform_admin'",
      [actor.user.id]
    )
  })
  afterAll(async () => environment?.close())

  it("exposes exactly the routable pages and applies their declared read permission", async () => {
    const response = await fetch(
      `${environment.baseURL}/api/v1/platform/menus/registry`,
      { headers: { origin, cookie: actor.cookie } }
    )
    expect(response.status, await response.clone().text()).toBe(200)
    const registry = await response.json()
    expect(
      registry.pages.toSorted((a, b) => a.key.localeCompare(b.key))
    ).toEqual(
      Object.entries(platformPages)
        .map(([key, page]) => ({ key, path: page.target.to }))
        .toSorted((a, b) => a.key.localeCompare(b.key))
    )
    for (const [key, page] of Object.entries(platformPages)) {
      const result = await environment.observer.query(
        "SELECT public.platform_menu_route_permission($1) AS permission",
        [key]
      )
      expect(result.rows[0].permission, key).toBe(page.permission)
    }
  })
})
