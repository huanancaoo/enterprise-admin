import { delay, http, HttpResponse } from "msw"
import { filePickerImage } from "./file-picker"

export const fileContentBytes = new Uint8Array([0, 255, 10, 128, 65])

export function createFileContentScenario(
  disposition: string,
  outcome: "success" | "denied" | "pending" = "success"
) {
  const requests: Request[] = []
  return {
    requests,
    reset: () => {
      requests.length = 0
    },
    handlers: [
      http.get(
        `*/api/v1/organizations/${filePickerImage.organizationId}/files/entries/${filePickerImage.id}/versions/${filePickerImage.currentVersion.id}/content`,
        async ({ request }) => {
          requests.push(request)
          if (outcome === "pending") await delay("infinite")
          if (outcome === "denied")
            return HttpResponse.json(
              {
                code: "FORBIDDEN",
                message: "File access was removed",
                locale: "en-US",
                requestId: "storybook-protected-content",
              },
              { status: 403 }
            )
          return new HttpResponse(fileContentBytes, {
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Disposition": disposition,
            },
          })
        }
      ),
    ],
  }
}
