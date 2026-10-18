import { delay, http, HttpResponse } from "msw"
import { taskCenterTask } from "../task-center"
import { CreateOrganizationInvitationImportSchema } from "@workspace/contracts/organization-invitations"

export function createBulkInvitationScenario(
  scenario: "success" | "failure" | "pending" = "success"
) {
  const submissions: { body: unknown; key: string | null }[] = []
  let downloads = 0
  return {
    submissions,
    get downloads() {
      return downloads
    },
    reset: () => {
      submissions.length = 0
      downloads = 0
    },
    handlers: [
      http.get(
        "*/api/v1/organizations/:organizationId/invitations/import-template",
        () => {
          downloads += 1
          return new HttpResponse(new Uint8Array([80, 75, 3, 4]), {
            headers: {
              "Content-Type":
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              "Content-Disposition":
                'attachment; filename="invitation-template.xlsx"',
            },
          })
        }
      ),
      http.post(
        "*/api/v1/organizations/:organizationId/invitations/imports",
        async ({ request }) => {
          submissions.push({
            body: CreateOrganizationInvitationImportSchema.parse(
              await request.json()
            ),
            key: request.headers.get("Idempotency-Key"),
          })
          if (scenario === "pending") await delay("infinite")
          if (scenario === "failure")
            return HttpResponse.json(
              {
                code: "INTERNAL_ERROR",
                message: "Invitation task unavailable",
                locale: "en-US",
                requestId: "bulk-invitation-story",
              },
              { status: 503 }
            )
          return HttpResponse.json(
            {
              ...taskCenterTask,
              type: "invitations.import",
              status: "submitted",
              result: null,
              resultAvailable: false,
            },
            { status: 202 }
          )
        }
      ),
    ],
  }
}
