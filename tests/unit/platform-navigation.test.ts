import { describe, expect, it } from "vitest"
import type { PlatformNavigationItem } from "../../packages/contracts/src/platform-system"
import {
  platformNavigationModel,
  platformPages,
} from "../../apps/platform/src/features/system/platform-pages"

const titles = { monitor: "Runtime", schedules: "Schedules" }
const node = (
  name: string,
  extra: Partial<PlatformNavigationItem> = {}
): PlatformNavigationItem => ({
  id: name,
  name,
  kind: "directory",
  routeKey: null,
  url: null,
  icon: null,
  hidden: false,
  children: [],
  ...extra,
})

describe("platform page navigation", () => {
  it.each(Object.entries(platformPages))(
    "opens registered page %s with its declared search",
    (key, page) => {
      const model = platformNavigationModel(
        [node("configured name", { kind: "page", routeKey: key })],
        page.target.to,
        titles
      )
      expect(model.home).toEqual(page.target)
      expect(model.items[0]?.target).toEqual(page.target)
      expect(page.validateSearch(page.target.search)).toBeDefined()
      expect(model.section?.name).toBe(
        key === "monitor" || key === "schedules"
          ? titles[key]
          : "configured name"
      )
    }
  )

  it("keeps three-level ancestry and uses exact path segments for details", () => {
    const nodes = [
      node("System", {
        children: [
          node("Logs", {
            children: [
              node("Operations", { kind: "page", routeKey: "audit-events" }),
            ],
          }),
        ],
      }),
    ]
    const model = platformNavigationModel(
      nodes,
      "/platform/audit-events/event-123",
      titles
    )
    expect(model.ancestors.map((item) => item.name)).toEqual(["System", "Logs"])
    expect(model.section?.name).toBe("Operations")
    expect(model.items[0]?.children[0]?.children[0]?.isActive).toBe(true)
    expect(
      platformNavigationModel(nodes, "/platform/audit-events-extra", titles)
        .section
    ).toBeUndefined()
  })

  it("omits hidden-only directories while retaining hidden page and iframe locations", () => {
    const nodes = [
      node("Hidden group", {
        children: [
          node("Private report", {
            kind: "iframe",
            hidden: true,
            url: "https://reports.example",
          }),
        ],
      }),
      node("Hidden users", { kind: "page", routeKey: "users", hidden: true }),
      node("Visible users", { kind: "page", routeKey: "users" }),
    ]
    const model = platformNavigationModel(
      nodes,
      "/platform/embedded/Private report",
      titles
    )
    expect(model.items.map((item) => item.name)).toEqual(["Visible users"])
    expect(model.home).toEqual(platformPages.users.target)
    expect(model.ancestors.map((item) => item.name)).toEqual(["Hidden group"])
    expect(model.section?.name).toBe("Private report")
    expect(
      platformNavigationModel(nodes, "/platform/users/user-1", titles).section
        ?.name
    ).toBe("Hidden users")
  })

  it("preserves menu icons and resolves the persisted schedule Clock icon", () => {
    const model = platformNavigationModel(
      [
        node("Schedule", {
          kind: "page",
          routeKey: "schedules",
          icon: "Clock",
        }),
      ],
      "/platform/schedules",
      titles
    )
    expect(model.items[0]?.Icon).toBeDefined()
    expect(model.items[0]?.icon).toBe("Clock")
  })

  it("skips external links and hidden ancestors when finding the home destination", () => {
    const model = platformNavigationModel(
      [
        node("External", { kind: "external", url: "https://example.test" }),
        node("Hidden", {
          hidden: true,
          children: [node("Users", { kind: "page", routeKey: "users" })],
        }),
        node("Frame", { kind: "iframe", url: "https://frame.example" }),
      ],
      "/platform",
      titles
    )
    expect(model.home).toEqual({
      to: "/platform/embedded/$menuId",
      params: { menuId: "Frame" },
    })
  })

  it("gives no home destination when the authorization projection has no internal page", () => {
    expect(
      platformNavigationModel([], "/platform", titles).home
    ).toBeUndefined()
    expect(
      platformNavigationModel(
        [node("External", { kind: "external", url: "https://example.test" })],
        "/platform",
        titles
      ).home
    ).toBeUndefined()
  })
})
