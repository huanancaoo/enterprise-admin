import { names, catalogs } from "./templates.mjs"
export function testTemplates(input) {
  const {
    domain: d,
    entity: e,
    Domain: D,
    Entity: E,
    table,
    name,
  } = names(input)
  const sample = "x".repeat(name.minLength)
  const files = new Map()
  files.set(
    `apps/api/src/${d}/${d}.spec.ts`,
    `import { describe, expect, it, vi, afterEach } from 'vitest';
import { ${D} } from './${d}';
import { ${e}Repository } from '@workspace/database/repositories/${d}';
import { auditRepository } from '@workspace/database/repositories/audit';
import type { AuthRuntime } from '../identity/auth-runtime';
import type { TenantWrite } from '../tenancy/tenant-write';
import type { TenantContext, TenantTx } from '@workspace/database/tenant';

afterEach(() => vi.restoreAllMocks());
describe('${D} write authorization and audit', () => {
  it('uses TenantWrite for the current identity and records success on the same transaction', async () => {
    const tx = {} as TenantTx;
    const context = { organizationId: '00000000-0000-4000-8000-000000000001', userId: '00000000-0000-4000-8000-000000000002', membershipId: '00000000-0000-4000-8000-000000000003', requestId: 'request', locale: 'zh-CN' } as const satisfies TenantContext;
    const headers = new Headers({ cookie: 'current-identity' });
    const item = { id: '00000000-0000-4000-8000-000000000004', organizationId: context.organizationId, name: '${sample}', createdAt: new Date('2026-01-01T00:00:00.000Z') };
    const create = vi.spyOn(${e}Repository, 'create').mockResolvedValue(item);
    const remove = vi.spyOn(${e}Repository, 'remove').mockResolvedValue(item);
    const audit = vi.spyOn(auditRepository, 'record').mockResolvedValue({
      command: 'INSERT',
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [],
    });
    const transaction = vi.fn((_context: TenantContext, _headers: Headers, _permissions: unknown, work: (tx: TenantTx) => Promise<unknown>) => work(tx));
    const service = new ${D}({} as AuthRuntime, { transaction } as unknown as TenantWrite);
    await expect(service.create(context, { name: '${sample}' }, headers)).resolves.toMatchObject({ id: item.id });
    expect(transaction).toHaveBeenCalledWith(context, headers, [{ ${e}: ['create'] }], expect.any(Function));
    expect(create).toHaveBeenCalledWith(tx, { name: '${sample}' });
    expect(audit).toHaveBeenCalledWith(tx, { resourceType: '${e}', eventCode: '${e}.created', resourceId: item.id, fields: {} });
    await service.remove(context, item.id, headers);
    expect(remove).toHaveBeenCalledWith(tx, item.id);
    expect(transaction).toHaveBeenLastCalledWith(context, headers, [{ ${e}: ['delete'] }], expect.any(Function));
    expect(audit).toHaveBeenLastCalledWith(tx, { resourceType: '${e}', eventCode: '${e}.deleted', resourceId: item.id, fields: {} });
    audit.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(service.create(context, { name: '${sample}' }, headers)).rejects.toThrow('audit unavailable');
  });
});
`
  )
  files.set(
    `tests/api/${d}.test.mjs`,
    `import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { startTestApplication } from "../setup/test-runtime.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { configureApiClient, create${E}, list${D}, delete${E}, listOrganizationAuditEvents } from "../../packages/api-client/src/index.ts"

const grants = ${JSON.stringify(input.grants)}
describe("${D}: generated module HTTP and runtime isolation", () => {
  let environment, actor, outsider, a, b
  const origin = "http://localhost:3200"
  beforeAll(async () => {
    environment = await startTestApplication({ origins: [origin] })
    const { baseURL, migrator, runtime } = environment
    actor = await signUpVerified(baseURL, origin, migrator)
    outsider = await signUpVerified(baseURL, origin, migrator)
    a = await runtime.auth.api.createOrganization({ headers: actor.headers, body: { name: "${D} A", slug: randomUUID() } })
    b = await runtime.auth.api.createOrganization({ headers: actor.headers, body: { name: "${D} B", slug: randomUUID() } })
    configureApiClient({ baseUrl: baseURL, getHeaders: () => ({ cookie: actor.cookie }) })
  })
  afterAll(async () => { await environment?.close() })
  const request = (org, method = "GET", suffix = "", body, cookie = actor.cookie) => fetch(environment.baseURL + "/api/v1/organizations/" + org + "/${d}" + suffix, { method, headers: { cookie, origin, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) })
  it("enforces authentication, membership and the declared grants", async () => {
    expect((await request(a.id, "GET", "", undefined, "")).status).toBe(401)
    expect((await request(a.id, "GET", "", undefined, outsider.cookie)).status).toBe(403)
    expect((await request(a.id)).status).toBe(grants.owner.includes("read") ? 200 : 403)
    expect((await request(a.id, "POST", "", { name: "${sample}" })).status).toBe(grants.owner.includes("create") ? 201 : 403)
    await environment.runtime.auth.api.addMember({ headers: actor.headers, body: { organizationId: a.id, userId: outsider.user.id, role: "member" } })
    expect((await request(a.id, "GET", "", undefined, outsider.cookie)).status).toBe(grants.member.includes("read") ? 200 : 403)
    expect((await request(a.id, "POST", "", { name: "${sample}" }, outsider.cookie)).status).toBe(grants.member.includes("create") ? 201 : 403)
    expect((await request(a.id, "DELETE", "/" + randomUUID(), undefined, outsider.cookie)).status).toBe(grants.member.includes("delete") ? 404 : 403)
  })
  it("keeps RLS forced with no unscope read or UPDATE grant", async () => {
    const { runtime, migrator } = environment
    expect((await runtime.pool.query('SELECT * FROM public."${table}"')).rows).toHaveLength(0)
    const state = await migrator.query("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.${table}'::regclass")
    expect(state.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true })
    expect((await runtime.pool.query("SELECT has_table_privilege(current_user, 'public.${table}', 'UPDATE') AS allowed")).rows[0].allowed).toBe(false)
  })
  ${
    input.grants.owner.includes("create") &&
    input.grants.owner.includes("read") &&
    input.grants.owner.includes("delete")
      ? `it("uses the generated SDK, keeps resource IDs scoped and appends success logs", async () => {
    const created = await create${E}(a.id, { name: "${sample}" })
    const id = created.data.id
    const page = await list${D}(a.id, { page: 1, pageSize: 20, name: "${sample}", sortBy: "createdAt", sortOrder: "desc" })
    expect(page.data.items.some((item) => item.id === id)).toBe(true)
    expect((await request(b.id, "DELETE", "/" + id)).status).toBe(404)
    await delete${E}(a.id, id)
    const events = await listOrganizationAuditEvents(a.id, { page: 1, pageSize: 20, resourceId: id })
    expect(events.data.items.map((event) => event.eventCode).sort()).toEqual(["${e}.created", "${e}.deleted"].sort())
    expect((await request(a.id, "POST", "", { name: "${sample}", organizationId: b.id })).status).toBe(400)
    const before = (await list${D}(a.id, { page: 1, pageSize: 20 })).data.total
    await environment.migrator.query("CREATE FUNCTION public.${d}_deny_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.resource_type = '${e}' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END; $$; CREATE TRIGGER ${d}_deny_audit BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.${d}_deny_audit()")
    try { expect((await request(a.id, "POST", "", { name: "${sample}" })).status).toBe(500) }
    finally { await environment.migrator.query("DROP TRIGGER ${d}_deny_audit ON public.audit_events; DROP FUNCTION public.${d}_deny_audit()") }
    expect((await list${D}(a.id, { page: 1, pageSize: 20 })).data.total).toBe(before)
  })`
      : ""
  }
})
`
  )
  files.set(
    `packages/mocks/src/handlers/${d}.ts`,
    `import { http, HttpResponse, delay } from "msw"
import { ${E}ListQuerySchema, type ${E}Response } from "@workspace/contracts"
const organizationId = "00000000-0000-4000-8000-000000000001"
const row = { id: "00000000-0000-4000-8000-000000000002", organizationId, name: "${sample}", createdAt: "2026-01-01T00:00:00.000Z" }
export function create${D}Scenario(scenario: "success" | "empty" | "loading" | "denied" | "failure" = "success") {
  let rows: ${E}Response[] = scenario === "empty" ? [] : [row]
  return [
    http.get("*/api/v1/organizations/:organizationId/access", () => HttpResponse.json({ organizationId, status: "ACTIVE", statusVersion: 1, authorizationVersion: 1, configuredLocale: null, effectiveLocale: "zh-CN" })),
    http.post("*/api/auth/organization/has-permission", () => HttpResponse.json({ success: scenario !== "denied" })),
    http.get("*/api/v1/organizations/:organizationId/${d}", async ({ request }) => {
      if (scenario === "loading") await delay("infinite")
      const query = ${E}ListQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
      const filtered = rows.filter((item) => !query.name || item.name.includes(query.name)).sort((a, b) => { const value = a[query.sortBy].localeCompare(b[query.sortBy]); return query.sortOrder === "asc" ? value : -value })
      return HttpResponse.json({ items: filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), page: query.page, pageSize: query.pageSize, total: filtered.length })
    }),
    http.post("*/api/v1/organizations/:organizationId/${d}", async ({ request }) => {
      if (scenario === "failure") return HttpResponse.json({ code: "INTERNAL_ERROR", locale: "en-US", requestId: "story", message: "failed" }, { status: 500 })
      const body = await request.json() as { name: string }
      const item = { ...row, id: crypto.randomUUID(), name: body.name }
      rows = [...rows, item]
      return HttpResponse.json(item, { status: 201 })
    }),
    http.delete("*/api/v1/organizations/:organizationId/${d}/:${e}Id", ({ params }) => { rows = rows.filter((item) => item.id !== params.${e}Id); return new HttpResponse(null, { status: 204 }) }),
  ]
}
`
  )
  files.set(
    `apps/tenant/src/features/${d}/${d}-list.stories.tsx`,
    `import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, within } from "storybook/test"
import { ${E}ListQuerySchema } from "@workspace/contracts"
import { create${D}Scenario } from "@workspace/mocks"
import { ${D}List } from "./${d}-list"
const organizationId = "00000000-0000-4000-8000-000000000001"
function Story() {
  const [search, setSearch] = useState(${E}ListQuerySchema.parse({}))
  return <${D}List organizationId={organizationId} search={search} onSearchChange={setSearch} />
}
const meta = { title: "Generated/${D}", component: Story, parameters: { layout: "fullscreen", msw: { handlers: create${D}Scenario() } } } satisfies Meta<typeof Story>
export default meta
type S = StoryObj<typeof meta>
export const Default: S = { play: async ({ canvasElement }) => { const canvas = within(canvasElement); await expect(await canvas.findByRole("table")).toBeVisible() } }
export const Empty: S = { parameters: { msw: { handlers: create${D}Scenario("empty") } } }
export const Loading: S = { parameters: { msw: { handlers: create${D}Scenario("loading") } } }
export const Denied: S = { parameters: { msw: { handlers: create${D}Scenario("denied") } } }
export const RTL: S = { globals: { locale: "ar" } }
export const ServerFailurePreservesName: S = { globals: { locale: "en-US" }, parameters: { msw: { handlers: create${D}Scenario("failure") } }, play: async ({ canvasElement }) => {
  const screen = within(canvasElement.ownerDocument.body)
  await userEvent.click(await within(canvasElement).findByRole("button", { name: "Create" }))
  const textbox = await screen.findByRole("textbox", { name: ${JSON.stringify(input.labels["en-US"].name)} })
  await userEvent.type(textbox, "${sample}")
  await userEvent.click(screen.getByRole("button", { name: "Save" }))
  await expect(await screen.findByRole("alert")).toBeVisible()
  await expect(textbox).toHaveValue("${sample}")
} }
`
  )
  files.set(
    `tests/e2e/${d}.test.mjs`,
    `import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { expect as expectUI } from "playwright/test"
import { startBrowserApplication } from "../setup/test-runtime.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"

const labels = ${JSON.stringify(catalogs(input)["zh-CN"])}
describe("${D}: generated routes, form and DataTable in Chromium", () => {
  let environment
  beforeAll(async () => { environment = await startBrowserApplication() })
  afterAll(async () => { await environment?.close() })
  it("keeps the domain across organization navigation, persists create and confirms deletion", async () => {
    const actor = await signUpVerified(environment.baseURL, environment.tenantOrigin, environment.migrator)
    const createOrganization = (name) => environment.runtime.auth.api.createOrganization({ headers: actor.headers, body: { name, slug: randomUUID() } })
    const a = await createOrganization("${D} A")
    const b = await createOrganization("${D} B")
    const context = await environment.browser.newContext({ viewport: { width: 1280, height: 900 } })
    try {
      await context.addCookies(actor.cookie.split("; ").map((part) => { const index = part.indexOf("="); return { name: part.slice(0, index), value: part.slice(index + 1), url: environment.tenantOrigin, httpOnly: true, sameSite: "Lax" } }))
      const page = await context.newPage()
      await page.goto(environment.tenantOrigin + "/app/${d}/" + a.id)
      await expectUI(page.getByRole("heading", { name: labels.title, exact: true })).toBeVisible()
      ${
        input.grants.owner.includes("create") &&
        input.grants.owner.includes("read") &&
        input.grants.owner.includes("delete")
          ? `await page.getByRole("button", { name: labels.create, exact: true }).click()
      const form = page.getByRole("dialog")
      const name = form.getByRole("textbox", { name: labels.name, exact: true })
      await expectUI(name).toBeFocused()
      await name.fill("${sample}")
      await form.getByRole("button", { name: "保存", exact: true }).click()
      await expectUI(form).toHaveCount(0)
      await expectUI(page.getByRole("table").getByText("${sample}", { exact: true })).toBeVisible()
      await page.reload()
      await expectUI(page.getByRole("table").getByText("${sample}", { exact: true })).toBeVisible()
      const loadedB = page.waitForResponse((response) => response.url().includes("/organizations/" + b.id + "/${d}") && response.request().method() === "GET" && response.status() === 200)
      await page.goto(environment.tenantOrigin + "/app/${d}/" + b.id)
      await loadedB
      await expectUI(page.getByRole("status").filter({ hasText: "暂无数据" })).toBeVisible()
      await expectUI(page.getByRole("table").getByText("${sample}", { exact: true })).toHaveCount(0)
      await page.goBack()
      await expectUI(page.getByRole("table").getByText("${sample}", { exact: true })).toBeVisible()
      const search = page.getByPlaceholder(labels.search, { exact: true })
      await search.fill("${sample}")
      await search.press("Enter")
      await expect.poll(() => new URL(page.url()).searchParams.get("name")).toBe("${sample}")
      await page.getByRole("table").getByRole("button", { name: labels.remove, exact: true }).click()
      await page.getByRole("alertdialog").getByRole("button", { name: "取消", exact: true }).click()
      await expectUI(page.getByRole("table").getByText("${sample}", { exact: true })).toBeVisible()
      await page.getByRole("table").getByRole("button", { name: labels.remove, exact: true }).click()
      await page.getByRole("alertdialog").getByRole("button", { name: labels.remove, exact: true }).click()
      await expectUI(page.getByRole("alertdialog")).toHaveCount(0)
      await expectUI(page.getByRole("table").getByText("${sample}", { exact: true })).toHaveCount(0)`
          : `expect(await page.getByRole("button", { name: labels.create, exact: true }).count()).toBe(${input.grants.owner.includes("create") ? 1 : 0})`
      }
    } finally { await context.close() }
  })
})
`
  )
  return files
}
