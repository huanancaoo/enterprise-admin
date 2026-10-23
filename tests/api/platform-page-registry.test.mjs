import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { startTestApplication } from "../setup/test-runtime.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { platformPages } from "../../apps/platform/src/features/system/platform-pages.ts"

describe("fixed platform pages and removed menu endpoints", () => {
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

  it("removes dynamic navigation endpoints while retaining each registered page permission", async () => {
    for (const path of ["menus", "menus/registry", "navigation"]) {
      const response = await fetch(
        `${environment.baseURL}/api/v1/platform/${path}`,
        {
          headers: { origin, cookie: actor.cookie },
        }
      )
      expect(response.status).toBe(404)
    }
    const exportResponse = await fetch(
      `${environment.baseURL}/api/v1/platform/exports`,
      {
        method: "POST",
        headers: {
          origin,
          cookie: actor.cookie,
          "content-type": "application/json",
          "idempotency-key": randomUUID(),
        },
        body: JSON.stringify({ resource: "menus", filters: {} }),
      }
    )
    expect(exportResponse.status).toBe(400)
    const { rows } = await environment.observer.query(
      "SELECT public.platform_permission_catalog() AS actions"
    )
    const actions = rows[0].actions
    expect(actions.some((action) => action.startsWith("platform.menu:"))).toBe(
      false
    )
    for (const page of Object.values(platformPages))
      expect(actions).toContain(page.permission)
    expect(Object.keys(platformPages)).toHaveLength(17)
  })
})
