import { http, HttpResponse } from "msw"
import { AnnouncementInboxPageSchema } from "@workspace/contracts/platform-announcements"

export function createEmptyTenantAnnouncementInboxHandler() {
  return http.get(
    "/api/v1/organizations/:organizationId/announcements",
    ({ request }) => {
      const search = new URL(request.url).searchParams
      return HttpResponse.json(
        AnnouncementInboxPageSchema.parse({
          items: [],
          page: Number(search.get("page") ?? 1),
          pageSize: Number(search.get("pageSize") ?? 20),
          total: 0,
          unreadCount: 0,
        })
      )
    }
  )
}
