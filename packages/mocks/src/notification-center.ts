import { http, HttpResponse, delay } from "msw"
export const notificationOrganizationId = "d1d1d1d1-1111-4111-8111-d1d1d1d1d1d1"
export const notificationUser = {
  id: "d2d2d2d2-1111-4111-8111-d2d2d2d2d2d2",
  name: "Notification owner",
  email: "notifications@example.test",
  image: null,
}
export const notificationTaskId = "d3d3d3d3-1111-4111-8111-d3d3d3d3d3d3"
const message = {
  id: "d4d4d4d4-1111-4111-8111-d4d4d4d4d4d4",
  organizationId: notificationOrganizationId,
  recipientId: notificationUser.id,
  type: "task.completed",
  taskId: notificationTaskId,
  taskType: "projects.export",
  createdAt: "2026-10-11T01:00:00.000Z",
  readAt: null,
}
export function createNotificationCenterScenario(
  mode:
    | "success"
    | "read-error"
    | "empty"
    | "denied"
    | "paginated"
    | "loading"
    | "load-error"
    | "read-denied" = "success"
) {
  let readAt: string | null = null
  let failed = false
  return {
    reset() {
      readAt = null
      failed = false
    },
    handlers: [
      http.post(
        "*/api/v1/organizations/:organizationId/notifications/:notificationId/read",
        () => {
          if (mode === "read-denied")
            return HttpResponse.json(
              {
                code: "FORBIDDEN",
                message: "FORBIDDEN",
                requestId: "storybook-notifications",
                locale: "en-US",
              },
              { status: 403 }
            )
          if (mode === "read-error" && !failed) {
            failed = true
            return HttpResponse.json(
              {
                code: "INTERNAL_ERROR",
                message: "INTERNAL_ERROR",
                requestId: "storybook-notifications",
                locale: "en-US",
              },
              { status: 500 }
            )
          }
          readAt = "2026-10-11T02:00:00.000Z"
          return HttpResponse.json({ ...message, readAt })
        }
      ),
      http.get("*/api/v1/organizations/:organizationId/access", () =>
        HttpResponse.json({
          organizationId: notificationOrganizationId,
          status: "ACTIVE",
          authorizationVersion: 1,
          effectiveLocale: "en-US",
          effectiveLocaleSource: "organization",
        })
      ),
      http.get(
        "*/api/v1/organizations/:organizationId/notifications",
        async ({ request }) => {
          if (mode === "loading") await delay("infinite")
          if (mode === "load-error")
            return HttpResponse.json(
              {
                code: "INTERNAL_ERROR",
                message: "INTERNAL_ERROR",
                requestId: "storybook-notifications",
                locale: "en-US",
              },
              { status: 500 }
            )
          if (mode === "denied")
            return HttpResponse.json(
              {
                code: "FORBIDDEN",
                message: "FORBIDDEN",
                requestId: "storybook-notifications",
                locale: "en-US",
              },
              { status: 403 }
            )
          const query = new URL(request.url).searchParams
          const page = Number(query.get("page") ?? 1),
            pageSize = Number(query.get("pageSize") ?? 20)
          const records =
            mode === "empty"
              ? []
              : mode === "paginated"
                ? Array.from({ length: 21 }, (_, index) => ({
                    ...message,
                    id: `d4d4d4d4-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
                    taskId: `d3d3d3d3-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
                    taskType:
                      index === 20 ? "projects.import" : "projects.export",
                    type: index === 20 ? "task.failed" : "task.completed",
                  }))
                : [{ ...message, readAt }]
          return HttpResponse.json({
            items: records.slice((page - 1) * pageSize, page * pageSize),
            page,
            pageSize,
            total: records.length,
            unreadCount:
              mode !== "empty" && readAt === null ? records.length : 0,
          })
        }
      ),
      http.get(
        "*/api/v1/organizations/:organizationId/notification-preferences",
        () => HttpResponse.json({ emailEnabled: false })
      ),
    ],
  }
}
