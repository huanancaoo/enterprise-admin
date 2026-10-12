import { delay, http, HttpResponse } from "msw"
import {
  NotificationPreferencesSchema,
  ApiErrorSchema,
} from "@workspace/contracts"
export function createNotificationPreferencesScenario(
  mode: "save" | "error" | "pending" = "save"
) {
  let emailEnabled = false
  return {
    reset: () => {
      emailEnabled = false
    },
    handlers: [
      http.get(
        "*/api/v1/organizations/:organizationId/notification-preferences",
        () =>
          HttpResponse.json(
            NotificationPreferencesSchema.parse({ emailEnabled })
          )
      ),
      http.put(
        "*/api/v1/organizations/:organizationId/notification-preferences",
        async ({ request }) => {
          if (mode === "error")
            return HttpResponse.json(
              ApiErrorSchema.parse({
                code: "AUTHORIZATION_UNAVAILABLE",
                message: "Notification preference save failed.",
                requestId: "pref-story",
                locale: "en-US",
              }),
              { status: 503 }
            )
          if (mode === "pending") await delay(500)
          emailEnabled = NotificationPreferencesSchema.parse(
            await request.json()
          ).emailEnabled
          return HttpResponse.json({ emailEnabled })
        }
      ),
    ],
  }
}
