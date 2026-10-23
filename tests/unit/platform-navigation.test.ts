import { describe, expect, it } from "vitest"
import {
  platformNavigationModel,
  platformPages,
} from "../../apps/platform/src/features/system/platform-pages"

const allPermissions = Object.values(platformPages).map(
  (page) => page.permission
)

describe("固定平台导航", () => {
  it("七个一级入口包含全部 17 个页面且每个页面只有一个归属", () => {
    const { items, home } = platformNavigationModel(allPermissions, "/platform")
    expect(items.map((item) => item.id)).toEqual([
      "organizations",
      "users",
      "content",
      "team",
      "security",
      "operations",
      "configuration",
    ])
    expect(items.map((item) => item.children.map((child) => child.id))).toEqual(
      [
        [],
        [],
        ["announcements", "files"],
        ["employees", "departments", "posts", "roles"],
        ["sessions", "login-events", "audit-events"],
        ["tasks", "schedules", "monitor"],
        ["dictionaries", "parameters", "settings"],
      ]
    )
    const pages = items.flatMap((item) =>
      item.target ? [item] : item.children
    )
    expect(pages).toHaveLength(17)
    expect(pages.map((item) => item.id).toSorted()).toEqual(
      Object.keys(platformPages).toSorted()
    )
    expect(pages.every((page) => page.children.length === 0)).toBe(true)
    expect(home).toEqual(platformPages.organizations.target)
  })

  it.each(Object.entries(platformPages))(
    "%s 的入口、首页和深链共用页面权限及查询定义",
    (key, page) => {
      const model = platformNavigationModel(
        [page.permission],
        `${page.target.to}/detail`
      )
      expect(model.home).toEqual(page.target)
      expect(model.section?.id).toBe(key)
      expect(model.section?.isActive).toBe(true)
      expect(page.validateSearch(page.target.search)).toBeDefined()
      expect(
        platformNavigationModel([], page.target.to).section
      ).toBeUndefined()
      expect(
        platformNavigationModel([page.permission], `${page.target.to}-extra`)
          .section
      ).toBeUndefined()
    }
  )

  it("受限角色仅保留获准页面和非空目录，撤权后入口与首页同步变化", () => {
    const permissions = [
      "platform.post:read",
      "platform.audit:read",
      "platform.settings:read",
    ]
    const model = platformNavigationModel(
      permissions,
      "/platform/audit-events/event"
    )
    expect(model.items.map((item) => item.id)).toEqual([
      "team",
      "security",
      "configuration",
    ])
    expect(model.ancestors.map((item) => item.id)).toEqual(["security"])
    expect(model.home).toEqual(platformPages.posts.target)
    expect(
      platformNavigationModel(["platform.audit:read"], "/platform").home
    ).toEqual(platformPages["audit-events"].target)
    expect(platformNavigationModel([], "/platform")).toMatchObject({
      items: [],
      home: undefined,
      section: undefined,
      ancestors: [],
    })
  })
})
