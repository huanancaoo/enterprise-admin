import { http, HttpResponse } from "msw"
import {
  CreatedWebhookSchema,
  WebhookListSchema,
  CreateWebhookSchema,
  UpdateWebhookSchema,
  WebhookSchema,
  OrganizationAccessSchema,
  WebhookDeliveryPageSchema,
} from "@workspace/contracts"
import { taskCenterOrganizationId } from "./task-center"
export const webhookSigningSecret =
  "whsec_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="
const endpoint = WebhookSchema.parse({
  id: "b412b4c5-8111-4111-a111-111111111111",
  organizationId: taskCenterOrganizationId,
  name: "Accounting events",
  url: "https://receiver.example.test/events",
  events: ["project.created"],
  enabled: true,
  createdAt: "2026-10-11T01:00:00.000Z",
})
export function createWebhooksScenario(mode: "empty" | "populated" = "empty") {
  let items: ReturnType<typeof WebhookListSchema.parse> =
    mode === "populated" ? [endpoint] : []
  return {
    reset: () => {
      items = mode === "populated" ? [endpoint] : []
    },
    handlers: [
      http.get("*/api/v1/organizations/:organizationId/access", () =>
        HttpResponse.json(
          OrganizationAccessSchema.parse({
            organizationId: taskCenterOrganizationId,
            status: "ACTIVE",
            authorizationVersion: 1,
            effectiveLocale: "en-US",
            effectiveLocaleSource: "user",
          })
        )
      ),
      http.post("*/api/auth/organization/has-permission", () =>
        HttpResponse.json({ success: true })
      ),
      http.get("*/api/v1/organizations/:organizationId/webhooks", () =>
        HttpResponse.json(WebhookListSchema.parse(items))
      ),
      http.post(
        "*/api/v1/organizations/:organizationId/webhooks",
        async ({ request }) => {
          const input = CreateWebhookSchema.parse(await request.json())
          const item = WebhookSchema.parse({ ...endpoint, ...input })
          items = [...items, item]
          return HttpResponse.json(
            CreatedWebhookSchema.parse({
              ...item,
              signingSecret: webhookSigningSecret,
            }),
            { status: 201 }
          )
        }
      ),
      http.put(
        "*/api/v1/organizations/:organizationId/webhooks/:webhookId",
        async ({ request }) => {
          const input = UpdateWebhookSchema.parse(await request.json())
          const item = WebhookSchema.parse({ ...endpoint, ...input })
          items = [item]
          return HttpResponse.json(item)
        }
      ),
      http.delete(
        "*/api/v1/organizations/:organizationId/webhooks/:webhookId",
        () => {
          items = []
          return new HttpResponse(null, { status: 204 })
        }
      ),
      http.get(
        "*/api/v1/organizations/:organizationId/webhooks/:webhookId/deliveries",
        () =>
          HttpResponse.json(
            WebhookDeliveryPageSchema.parse({
              items: [],
              total: 0,
              page: 1,
              pageSize: 20,
            })
          )
      ),
    ],
  }
}
