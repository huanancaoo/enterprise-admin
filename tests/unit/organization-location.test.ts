import { describe, expect, it } from "vitest"
import { getOrganizationLocation } from "../../apps/tenant/src/lib/organization-location"

const search = {
  page: 3,
  pageSize: 50,
  name: "query",
  status: "active",
  sortBy: "updatedAt",
  sortOrder: "asc",
} as const
function location(
  pathname: string,
  params: { projectId?: string; entryId?: string } = {}
) {
  return getOrganizationLocation({ pathname, params, search })
}

describe("组织当前位置", () => {
  it.each([
    [
      "/app/projects/north",
      "projects",
      "projects:title",
      "organization:businessWork",
    ],
    ["/app/files/north", "files", "files:title", "organization:businessWork"],
    [
      "/app/announcements/north",
      "announcements",
      "announcements:title",
      undefined,
    ],
    [
      "/app/notifications/north",
      "notifications",
      "notifications:title",
      undefined,
    ],
    ["/app/tasks/north", "tasks", "tasks:title", "organization:businessWork"],
    [
      "/app/integrations/north",
      "integrations",
      "webhooks:integrations",
      "organization:developerIntegration",
    ],
    [
      "/app/members/north",
      "members",
      "organization:membersAndInvitations",
      "organization:management",
    ],
    [
      "/app/organizations/north/roles",
      "roles",
      "organization:rolesAndPermissions",
      "organization:management",
    ],
    [
      "/app/organizations/north/roles/",
      "roles",
      "organization:rolesAndPermissions",
      "organization:management",
    ],
    [
      "/app/organizations/north/settings",
      "organizationSettings",
      "settings:generalSettings",
      "organization:management",
    ],
    [
      "/app/organizations/north/audit",
      "audit",
      "organization:audit",
      "organization:management",
    ],
    [
      "/app/settings/login-events",
      "personalSettings",
      "identity:personalLoginEvents",
      undefined,
    ],
    [
      "/app/settings/preferences",
      "personalSettings",
      "settings:personalSettings",
      undefined,
    ],
  ])(
    "从 %s 统一得到导航位置、标题与业务分区",
    (path, page, titleKey, sectionTitleKey) => {
      expect(location(path)).toMatchObject({ page, titleKey, sectionTitleKey })
    }
  )

  it.each([
    ["announcements", "/app/announcements/$organizationId"],
    ["notifications", "/app/notifications/$organizationId"],
    ["tasks", "/app/tasks/$organizationId"],
    ["organizations/north/audit", "/app/organizations/$organizationId/audit"],
  ])("切换 %s 清除上一组织筛选并从第一页开始", (part, to) => {
    const pathname = part.startsWith("organizations/")
      ? `/app/${part}`
      : `/app/${part}/north`
    expect(location(pathname).switchTarget("south")).toEqual({
      to,
      params: { organizationId: "south" },
      search: { page: 1, pageSize: 20 },
    })
  })

  it("项目列表切组织保留当前列表条件，详情返回项目列表且不携带详情查询", () => {
    expect(location("/app/projects/north").switchTarget("south")).toEqual({
      to: "/app/projects/$organizationId",
      params: { organizationId: "south" },
      search: { ...search, page: 1 },
    })
    const detail = location("/app/projects/north/project", {
      projectId: "project",
    })
    expect(detail.titleKey).toBe("projects:detail")
    expect(detail.projectDetail).toBe(true)
    expect(detail.switchTarget("south")).toEqual({
      to: "/app/projects/$organizationId",
      params: { organizationId: "south" },
      search: {},
    })
    expect(detail.link("projects", "north").search).toEqual({})
  })

  it("文件列表使用工作区布局；文件详情使用普通布局与详情标题", () => {
    expect(location("/app/files/north").layout).toBe("workspace")
    expect(location("/app/files/north").switchTarget("south").search).toEqual(
      {}
    )
    expect(
      location("/app/files/north/file", { entryId: "file" })
    ).toMatchObject({ layout: "page", titleKey: "files:detail" })
  })

  it.each([
    ["/app/files/north", "/app/files/$organizationId"],
    [
      "/app/organizations/north/audit",
      "/app/organizations/$organizationId/audit",
    ],
    ["/app/members/north", "/app/members/$organizationId"],
    [
      "/app/organizations/north/roles",
      "/app/organizations/$organizationId/roles",
    ],
    [
      "/app/organizations/north/settings",
      "/app/organizations/$organizationId/settings",
    ],
    ["/app/tasks/north", "/app/projects/$organizationId"],
    ["/app/notifications/north", "/app/projects/$organizationId"],
    ["/app/announcements/north", "/app/projects/$organizationId"],
    ["/app/integrations/north", "/app/projects/$organizationId"],
  ])("创建组织从 %s 进入既定初始位置，不等同切换已有组织", (path, to) => {
    expect(location(path).createdTarget("created")).toEqual({
      to,
      params: { organizationId: "created" },
    })
  })

  it("角色路径不吞并相邻页面；无组织的个人页切组织进入项目列表", () => {
    expect(location("/app/organizations/north/roles-extra").page).not.toBe(
      "roles"
    )
    const personal = location("/app/settings/preferences")
    expect(personal.personal).toBe(true)
    expect(personal.switchTarget("south").to).toBe(
      "/app/projects/$organizationId"
    )
  })
})
