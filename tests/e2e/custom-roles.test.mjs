import { randomBytes } from "node:crypto"
import { createRequire } from "node:module"
const storybookRequire = createRequire(
  new URL("../../apps/storybook/package.json", import.meta.url)
)
const a11yRequire = createRequire(
  storybookRequire.resolve("@storybook/addon-a11y")
)
import { expect as expectUI } from "playwright/test"
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { startBrowserApplication } from "../setup/test-runtime.mjs"

async function signIn(page, account) {
  await page.getByLabel("邮箱", { exact: true }).fill(account.email)
  await page.getByLabel("密码", { exact: true }).fill(account.password)
  await page.getByRole("button", { name: "登录", exact: true }).click()
}

async function selectLocale(page, userName, locale) {
  await page.getByRole("button", { name: new RegExp(userName) }).click()
  // 子菜单的鼠标入口依赖 hover；键盘流程使用明确的打开动作。
  const language = page.getByRole("menuitem", { name: "语言", exact: true })
  await language.focus()
  await language.press("Enter")
  const option = page.getByRole("menuitemradio", { name: locale, exact: true })
  await expectUI(option).toBeVisible()
  await option.focus()
  await page.keyboard.press("Enter")
}

describe("S8-05：组织自定义角色浏览器流程", () => {
  let environment
  let context
  let page

  beforeAll(async () => {
    environment = await startBrowserApplication()
  })

  beforeEach(async () => {
    context = await environment.browser.newContext({
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: { "x-real-ip": `10.${[...randomBytes(3)].join(".")}` },
    })
    page = await context.newPage()
  })

  afterEach(async () => {
    await context.close()
  })

  afterAll(async () => {
    await environment?.close()
  })

  it("创建角色并在成员管理中分配", async () => {
    const owner = await signUpVerified(
      environment.baseURL,
      environment.tenantOrigin,
      environment.migrator,
      { name: "角色所有者" }
    )
    const member = await signUpVerified(
      environment.baseURL,
      environment.tenantOrigin,
      environment.migrator,
      { name: "角色成员" }
    )
    const organization = await environment.runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: {
        name: "角色验收组织",
        slug: `role-e2e-${randomBytes(5).toString("hex")}`,
      },
    })
    await environment.runtime.auth.api.addMember({
      headers: owner.headers,
      body: {
        organizationId: organization.id,
        userId: member.user.id,
        role: "member",
      },
    })

    await page.goto(environment.tenantOrigin + "/app/")
    await signIn(page, owner)
    await page.getByRole("link", { name: "角色", exact: true }).click()
    await expectUI(
      page.getByRole("heading", { name: "角色", exact: true })
    ).toBeVisible()
    await page.getByLabel("角色标识", { exact: true }).fill("project-reader")
    await page
      .getByRole("checkbox", { name: "项目：查看", exact: true })
      .check()
    await page.getByRole("button", { name: "创建角色", exact: true }).click()
    await expectUI(
      page.getByText("project-reader", { exact: true })
    ).toBeVisible()

    await page.getByRole("link", { name: "成员", exact: true }).click()
    const list = page.getByRole("list", { name: "成员", exact: true })
    const row = list.getByRole("listitem").filter({ hasText: member.email })
    await row.getByRole("button", { name: "更改角色", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("角色", { exact: true }).click()
    await page
      .getByRole("option", { name: "project-reader", exact: true })
      .click()
    await dialog.getByRole("button", { name: "保存", exact: true }).click()
    await expectUI(dialog).toHaveCount(0)
    await expectUI(row).toContainText("project-reader")
    expect(page.url()).toContain("/app/members/")
  })

  it("委派成员管理动作可修改和移除普通成员，仍不能管理 owner/admin 或读取角色目录", async () => {
    const owner = await signUpVerified(
      environment.baseURL,
      environment.tenantOrigin,
      environment.migrator,
      { name: "委派组织所有者" }
    )
    const manager = await signUpVerified(
      environment.baseURL,
      environment.tenantOrigin,
      environment.migrator,
      { name: "委派成员管理者" }
    )
    const target = await signUpVerified(
      environment.baseURL,
      environment.tenantOrigin,
      environment.migrator,
      { name: "委派目标成员" }
    )
    const administrator = await signUpVerified(
      environment.baseURL,
      environment.tenantOrigin,
      environment.migrator,
      { name: "受保护管理员" }
    )
    const org = await environment.runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: {
        name: "委派成员管理组织",
        slug: `delegated-member-${randomBytes(5).toString("hex")}`,
      },
    })
    for (const [role, permission] of [
      [
        "team-manager",
        { project: ["read"], member: ["read", "update", "delete"] },
      ],
      ["project-editor", { project: ["read", "update"] }],
    ])
      await environment.runtime.auth.api.createOrgRole({
        headers: owner.headers,
        body: { organizationId: org.id, role, permission },
      })
    let targetMembership
    for (const [account, role] of [
      [manager, "team-manager"],
      [target, "project-editor"],
      [administrator, "admin"],
    ]) {
      const membership = await environment.runtime.auth.api.addMember({
        headers: owner.headers,
        body: { organizationId: org.id, userId: account.user.id, role },
      })
      if (account === target) targetMembership = membership
    }
    await page.goto(environment.tenantOrigin + "/app/")
    await signIn(page, manager)
    await page.getByRole("link", { name: "成员", exact: true }).click()
    const list = page.getByRole("list", { name: "成员", exact: true })
    const row = (account) =>
      list.getByRole("listitem").filter({ hasText: account.email })
    await expectUI(
      row(target).getByRole("button", { name: "更改角色", exact: true })
    ).toBeVisible()
    await expectUI(
      row(target).getByRole("button", { name: "移除成员", exact: true })
    ).toBeVisible()
    for (const account of [owner, administrator])
      await expectUI(row(account).getByRole("button")).toHaveCount(0)
    await expectUI(
      row(manager).getByRole("button", { name: "移除成员", exact: true })
    ).toHaveCount(0)

    // member:update 不授予 ac:read，界面不能依赖无法读取的动态角色目录。
    const catalog = await context.request.get(
      `${environment.tenantOrigin}/api/auth/organization/list-roles?organizationId=${org.id}`
    )
    expect(catalog.status()).toBe(403)
    await row(target)
      .getByRole("button", { name: "更改角色", exact: true })
      .click()
    const dialog = page.getByRole("dialog")
    await expectUI(dialog.getByLabel("角色", { exact: true })).toContainText(
      "project-editor"
    )
    await dialog.getByLabel("角色", { exact: true }).click()
    for (const name of ["所有者", "管理员"])
      await expectUI(
        page.getByRole("option", { name, exact: true })
      ).toHaveCount(0)
    await page.getByRole("option", { name: "成员", exact: true }).click()
    const updated = page.waitForResponse(
      (response) =>
        response.url().endsWith("/organization/update-member-role") &&
        response.request().method() === "POST"
    )
    await dialog.getByRole("button", { name: "保存", exact: true }).click()
    expect((await updated).status()).toBe(200)
    await expectUI(dialog).toHaveCount(0)
    await expectUI(row(target)).toContainText("成员")
    expect(
      (
        await environment.migrator.query(
          "SELECT role FROM member WHERE id = $1",
          [targetMembership.id]
        )
      ).rows
    ).toEqual([{ role: "member" }])

    await row(target)
      .getByRole("button", { name: "移除成员", exact: true })
      .focus()
    await page.keyboard.press("Enter")
    const removed = page.waitForResponse(
      (response) =>
        response.url().endsWith("/organization/remove-member") &&
        response.request().method() === "POST"
    )
    await dialog.getByRole("button", { name: "移除成员", exact: true }).focus()
    await page.keyboard.press("Enter")
    expect((await removed).status()).toBe(200)
    await expectUI(dialog).toHaveCount(0)
    await expectUI(row(target)).toHaveCount(0)
    await expectUI(page.getByLabel("搜索成员…", { exact: true })).toBeFocused()
    expect(
      (
        await environment.migrator.query(
          "SELECT id FROM member WHERE id = $1",
          [targetMembership.id]
        )
      ).rows
    ).toHaveLength(0)
    expect(
      (
        await environment.migrator.query(
          'SELECT id FROM "user" WHERE id = $1',
          [target.user.id]
        )
      ).rows
    ).toHaveLength(1)
    const audit = await environment.migrator.query(
      "SELECT event_code FROM audit_events WHERE organization_id = $1 AND resource_id = $2 ORDER BY occurred_at",
      [org.id, targetMembership.id]
    )
    expect(audit.rows.map((row) => row.event_code)).toEqual([
      "member.role_changed",
      "member.removed",
    ])
  })

  it("显示引用数量，确认收回权限，并在解除成员引用后删除角色", async () => {
    const owner = await signUpVerified(
      environment.baseURL,
      environment.tenantOrigin,
      environment.migrator,
      { name: "角色编辑者" }
    )
    const member = await signUpVerified(
      environment.baseURL,
      environment.tenantOrigin,
      environment.migrator,
      { name: "受影响成员" }
    )
    const org = await environment.runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: {
        name: "角色更新组织",
        slug: `edit-${randomBytes(5).toString("hex")}`,
      },
    })
    await environment.runtime.auth.api.createOrgRole({
      headers: owner.headers,
      body: {
        organizationId: org.id,
        role: "project-editor",
        permission: { project: ["read", "update"] },
      },
    })
    const membership = await environment.runtime.auth.api.addMember({
      headers: owner.headers,
      body: {
        organizationId: org.id,
        userId: member.user.id,
        role: "project-editor",
      },
    })
    await page.goto(environment.tenantOrigin + "/app/")
    await signIn(page, owner)
    await page.getByRole("link", { name: "角色", exact: true }).click()
    const row = page.getByRole("listitem").filter({ hasText: "project-editor" })
    await expectUI(row).toContainText("成员：1；有效邀请：0")
    await row.getByRole("button", { name: "修改权限", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await expectUI(dialog).toContainText("成员：1；有效邀请：0")
    await dialog
      .getByRole("checkbox", { name: "项目：编辑", exact: true })
      .uncheck()
    await dialog.getByRole("button", { name: "确认更新", exact: true }).click()
    await expectUI(dialog).toHaveCount(0)
    await expectUI(row).not.toContainText("项目：编辑")
    await row.getByRole("button", { name: "删除角色", exact: true }).click()
    await dialog.getByRole("button", { name: "确认删除", exact: true }).click()
    await expectUI(dialog.getByRole("alert")).toHaveText(
      "该角色仍被 1 位成员和 0 个有效邀请引用，请先解除引用。"
    )
    await dialog.getByRole("button", { name: "取消", exact: true }).click()
    const version = (
      await environment.migrator.query(
        "SELECT authorization_version FROM organization_status WHERE organization_id = $1",
        [org.id]
      )
    ).rows[0].authorization_version
    const headers = new Headers(owner.headers)
    headers.set("X-Expected-Authz-Version", String(version))
    await environment.runtime.auth.api.updateMemberRole({
      headers,
      body: { organizationId: org.id, memberId: membership.id, role: "member" },
    })
    await page.reload()
    await row.getByRole("button", { name: "删除角色", exact: true }).click()
    await dialog.getByRole("button", { name: "确认删除", exact: true }).click()
    await expectUI(dialog).toHaveCount(0)
    await expectUI(row).toHaveCount(0)
  })

  it.each([
    {
      locale: "English",
      lang: "en-US",
      dir: "ltr",
      edit: "Edit permissions",
      update: "Confirm update",
      remove: "Delete role",
      confirmDelete: "Confirm deletion",
      cancel: "Cancel",
      permission: "Projects: update",
      counts: "Members: 0; active invitations: 0",
      stale:
        "The role or its references changed. Close this dialog and confirm again.",
    },
    {
      locale: "العربية",
      lang: "ar",
      dir: "rtl",
      edit: "تعديل الصلاحيات",
      update: "تأكيد التحديث",
      remove: "حذف الدور",
      confirmDelete: "تأكيد الحذف",
      cancel: "إلغاء",
      permission: "المشاريع: تعديل",
      counts: "الأعضاء: 0؛ الدعوات السارية: 0",
      stale: "تغير الدور أو ارتباطاته. أغلق النافذة وأكد من جديد.",
    },
  ])("$lang 的更新删除支持键盘、无障碍与陈旧版本草稿保留", async (labels) => {
    const owner = await signUpVerified(
      environment.baseURL,
      environment.tenantOrigin,
      environment.migrator,
      { name: "键盘角色所有者" }
    )
    const org = await environment.runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: {
        name: "多语角色组织",
        slug: `keyboard-${randomBytes(5).toString("hex")}`,
      },
    })
    await environment.runtime.auth.api.createOrgRole({
      headers: owner.headers,
      body: {
        organizationId: org.id,
        role: "keyboard-editor",
        permission: { project: ["read", "update"] },
      },
    })
    await page.goto(environment.tenantOrigin + "/app/")
    await signIn(page, owner)
    await page.getByRole("link", { name: "角色", exact: true }).click()
    await selectLocale(page, "键盘角色所有者", labels.locale)
    await expectUI(page.locator("html")).toHaveAttribute("lang", labels.lang)
    await expectUI(page.locator("html")).toHaveAttribute("dir", labels.dir)
    const row = page
      .getByRole("listitem")
      .filter({ hasText: "keyboard-editor" })
    const edit = row.getByRole("button", { name: labels.edit, exact: true })
    await edit.focus()
    await page.keyboard.press("Enter")
    const dialog = page.getByRole("dialog")
    await expectUI(dialog).toContainText(labels.counts)
    await page.addScriptTag({
      path: a11yRequire.resolve("axe-core/axe.min.js"),
    })
    const violations = await page.evaluate(
      async () =>
        (
          await window.axe.run(document.querySelector('[role="dialog"]'), {
            runOnly: {
              type: "tag",
              values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
            },
          })
        ).violations
    )
    expect(violations).toEqual([])
    const checkbox = dialog.getByRole("checkbox", {
      name: labels.permission,
      exact: true,
    })
    await checkbox.focus()
    await page.keyboard.press("Space")
    await expectUI(checkbox).not.toBeChecked()
    await environment.runtime.auth.api.createOrgRole({
      headers: owner.headers,
      body: {
        organizationId: org.id,
        role: "other-role",
        permission: { project: ["read"] },
      },
    })
    const submit = dialog.getByRole("button", {
      name: labels.update,
      exact: true,
    })
    await submit.focus()
    await page.keyboard.press("Enter")
    await expectUI(dialog.getByRole("alert")).toHaveText(labels.stale)
    await expectUI(checkbox).not.toBeChecked()
    await expectUI(submit).toBeDisabled()
    await dialog
      .getByRole("button", { name: labels.cancel, exact: true })
      .click()
    await expectUI(dialog).toHaveCount(0)
    await expectUI(edit).toBeFocused()
    await edit.press("Enter")
    await dialog
      .getByRole("checkbox", { name: labels.permission, exact: true })
      .uncheck()
    await dialog
      .getByRole("button", { name: labels.update, exact: true })
      .press("Enter")
    await expectUI(dialog).toHaveCount(0)
    await expectUI(row).not.toContainText(labels.permission)
    const remove = row.getByRole("button", { name: labels.remove, exact: true })
    await remove.focus()
    await page.keyboard.press("Enter")
    await dialog
      .getByRole("button", { name: labels.confirmDelete, exact: true })
      .press("Enter")
    await expectUI(dialog).toHaveCount(0)
    await expectUI(row).toHaveCount(0)
    await expectUI(page.locator("#custom-roles-title")).toBeFocused()
  })

  it("在阿语 RTL 下支持键盘创建、校验错误和重复角色错误", async () => {
    const owner = await signUpVerified(
      environment.baseURL,
      environment.tenantOrigin,
      environment.migrator,
      { name: "RTL角色所有者" }
    )
    await environment.runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: {
        name: "RTL角色验收组织",
        slug: `role-rtl-e2e-${randomBytes(5).toString("hex")}`,
      },
    })

    await page.goto(environment.tenantOrigin + "/app/")
    await signIn(page, owner)
    await page.getByRole("link", { name: "角色", exact: true }).click()
    await selectLocale(page, "RTL角色所有者", "العربية")
    await expectUI(page.locator("html")).toHaveAttribute("lang", "ar")
    await expectUI(page.locator("html")).toHaveAttribute("dir", "rtl")

    await expectUI(
      page.getByRole("heading", { name: "الأدوار", exact: true })
    ).toBeVisible()
    const roleKey = page.getByLabel("مفتاح الدور", { exact: true })
    await expectUI(roleKey).toBeVisible()
    await expectUI(
      page.getByText(
        "استخدم 3–48 حرفاً صغيراً أو رقماً أو شرطة. المفاتيح التي تبدأ بـ platform محجوزة. لا يمكن تغيير المفتاح لاحقاً.",
        { exact: true }
      )
    ).toBeVisible()
    await expectUI(
      page.getByRole("button", { name: "إنشاء دور", exact: true })
    ).toBeVisible()

    await roleKey.fill("platformer")
    await page.getByRole("button", { name: "إنشاء دور", exact: true }).click()
    await expectUI(roleKey).toHaveAttribute("aria-invalid", "true")
    await expectUI(
      page.getByText(
        "أدخل مفتاح دور صالحاً؛ لا يُسمح بالأسماء المحجوزة أو المفاتيح التي تبدأ بـ platform.",
        { exact: true }
      )
    ).toBeVisible()

    await roleKey.fill("")
    await roleKey.focus()
    await page.keyboard.type("-keyboard-reader")
    await expectUI(roleKey).toHaveValue("-keyboard-reader")
    const permission = page.getByRole("checkbox").first()
    await page.keyboard.press("Tab")
    await expectUI(permission).toBeFocused()
    await page.keyboard.press("Space")
    await expectUI(permission).toBeChecked()
    await page.keyboard.press("Shift+Tab")
    await expectUI(roleKey).toBeFocused()
    await page.keyboard.press("Tab")
    const checkboxes = page.getByRole("checkbox")
    const checkboxCount = await checkboxes.count()
    for (let index = 0; index < checkboxCount; index += 1) {
      await page.keyboard.press("Tab")
    }
    const createButton = page.getByRole("button", {
      name: "إنشاء دور",
      exact: true,
    })
    await expectUI(createButton).toBeFocused()
    const submitted = Promise.withResolvers()
    const release = Promise.withResolvers()
    await page.route(
      "**/api/auth/organization/create-role",
      async (route) => {
        const response = await route.fetch()
        submitted.resolve()
        await release.promise
        await route.fulfill({ response })
      },
      { times: 1 }
    )
    const creationForm = page.locator("form").filter({ has: roleKey })
    try {
      await page.keyboard.press("Enter")
      await submitted.promise
      await expectUI(creationForm).toHaveAttribute("aria-busy", "true")
      await expectUI(roleKey).toBeDisabled()
      await expectUI(permission).toBeDisabled()
    } finally {
      release.resolve()
      await page.unrouteAll({ behavior: "wait" })
    }
    await expectUI(
      page.getByText("-keyboard-reader", { exact: true })
    ).toBeVisible()
    await expectUI(creationForm).toHaveAttribute("aria-busy", "false")
    await expectUI(roleKey).toHaveValue("")

    await roleKey.fill("-keyboard-reader")
    await permission.check()
    await createButton.click()
    const errorAlert = page.getByRole("alert")
    await expectUI(errorAlert).toBeVisible()
    await expectUI(errorAlert).not.toBeEmpty()
    await expectUI(errorAlert).toHaveText(
      "مفتاح الدور مستخدم بالفعل في هذه المؤسسة."
    )
    await expectUI(roleKey).toHaveValue("-keyboard-reader")
  })
})
