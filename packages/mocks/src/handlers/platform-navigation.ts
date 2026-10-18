import { http, HttpResponse } from "msw"
import { PlatformNavigationSchema } from "@workspace/contracts/platform-system"

export const hiddenPlatformFrameId = "c7dd0a27-4f8a-4aef-8d4c-000000009701"
export const hiddenPlatformFrameUrl = "https://frame.example.invalid/report"

export function createPlatformLayoutNavigationHandler() {
  // 默认入口由授权导航中的首个页面决定，布局夹具必须提供该投影。
  const navigation = PlatformNavigationSchema.parse({
    items: [
      ["organizations", "组织管理"],
      ["users", "全局账号"],
      ["audit-events", "操作日志"],
      ["settings", "平台设置"],
    ].map(([routeKey, name], index) => ({
      id: `c7dd0a27-4f8a-4aef-8d4c-${String(index + 1).padStart(12, "0")}`,
      name,
      kind: "page",
      routeKey,
      url: null,
      icon: null,
      hidden: false,
      children: [],
    })),
  })
  return http.get("*/api/v1/platform/navigation", () =>
    HttpResponse.json(navigation)
  )
}

export function createHiddenPlatformFrameHandler() {
  const navigation = PlatformNavigationSchema.parse({
    items: [
      {
        id: "c7dd0a27-4f8a-4aef-8d4c-000000009700",
        name: "Hidden children only",
        kind: "directory",
        routeKey: null,
        url: null,
        icon: null,
        hidden: false,
        children: [
          {
            id: hiddenPlatformFrameId,
            name: "Private report",
            kind: "iframe",
            routeKey: null,
            url: hiddenPlatformFrameUrl,
            icon: null,
            hidden: true,
            children: [],
          },
        ],
      },
      {
        id: "c7dd0a27-4f8a-4aef-8d4c-000000009702",
        name: "Visible portal",
        kind: "external",
        routeKey: null,
        url: "https://portal.example.invalid",
        icon: null,
        hidden: false,
        children: [],
      },
    ],
  })
  return http.get("*/api/v1/platform/navigation", () =>
    HttpResponse.json(navigation)
  )
}
