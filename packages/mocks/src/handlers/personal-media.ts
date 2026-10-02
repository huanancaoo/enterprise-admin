import { delay, http, HttpResponse } from "msw"
import {
  PersonalAvatarResultSchema,
  PersonalMediaContentTypeSchema,
  PersonalMediaUploadKeySchema,
  PersonalMediaUploadResultSchema,
  SetPersonalAvatarSchema,
  personalMediaMaximumBytes,
  type ApiErrorCode,
} from "@workspace/contracts"

export const personalAvatarUser = {
  id: "e430c8b4-8de4-4eb4-a0f2-c5017656a700",
  name: "Avatar editor",
  email: "avatar-editor@example.test",
  image: null as string | null,
}
export const personalAvatarImage = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAE0lEQVQImWP4z8DwnwGM/zMwAAAf7gP9qS/A4gAAAABJRU5ErkJggg=="
  ),
  (value) => value.charCodeAt(0)
)
export type PersonalAvatarScenario =
  | "success"
  | "slow-upload"
  | "slow-save"
  | "upload-error"
  | "save-conflict"
  | "save-error"
  | "save-unknown"
  | "unauthorized"

export function createPersonalAvatarScenario(
  scenario: PersonalAvatarScenario = "success"
) {
  const initialMediaId = "e430c8b4-8de4-4eb4-a0f2-c5017656a701"
  const uploadedMediaId = "e430c8b4-8de4-4eb4-a0f2-c5017656a702"
  const contentUrl = (id: string) => `/api/v1/personal-media/${id}/content`
  let image: string | null = contentUrl(initialMediaId)
  let saveFailed = false
  let uploadedBytes = personalAvatarImage
  let uploadedContentType = "image/png"
  const saves: unknown[] = []
  const uploads: { key: string; type: string; bytes: number }[] = []
  const error = (status: number, code: ApiErrorCode) =>
    HttpResponse.json(
      { code, message: code, requestId: "storybook-avatar", locale: "en-US" },
      { status }
    )
  return {
    user: { ...personalAvatarUser, image },
    snapshot: () => ({ image, saves: [...saves], uploads: [...uploads] }),
    reset() {
      image = contentUrl(initialMediaId)
      saveFailed = false
      uploadedBytes = personalAvatarImage
      uploadedContentType = "image/png"
      saves.length = 0
      uploads.length = 0
    },
    handlers: [
      http.get("*/api/auth/get-session", () =>
        HttpResponse.json({
          user: {
            ...personalAvatarUser,
            image,
            emailVerified: true,
            createdAt: "2026-10-01T00:00:00Z",
            updatedAt: "2026-10-01T00:00:00Z",
          },
          session: {
            id: "avatar-session",
            userId: personalAvatarUser.id,
            expiresAt: "2099-01-01T00:00:00Z",
            createdAt: "2026-10-01T00:00:00Z",
            updatedAt: "2026-10-01T00:00:00Z",
          },
        })
      ),
      http.get("*/api/v1/personal-media/:mediaId/content", ({ params }) =>
        params.mediaId === initialMediaId || params.mediaId === uploadedMediaId
          ? new HttpResponse(
              new Blob([
                params.mediaId === initialMediaId
                  ? personalAvatarImage
                  : uploadedBytes,
              ]),
              {
                headers: {
                  "Content-Type":
                    params.mediaId === initialMediaId
                      ? "image/png"
                      : uploadedContentType,
                },
              }
            )
          : error(404, "NOT_FOUND")
      ),
      http.post("*/api/v1/personal-media", async ({ request }) => {
        if (scenario === "slow-upload") await delay("infinite")
        if (scenario === "unauthorized") return error(401, "UNAUTHENTICATED")
        if (scenario === "upload-error")
          return error(503, "FILE_STORAGE_UNAVAILABLE")
        const key = PersonalMediaUploadKeySchema.safeParse(
          request.headers.get("Idempotency-Key")
        )
        const type = PersonalMediaContentTypeSchema.safeParse(
          request.headers.get("Content-Type")
        )
        const body = new Uint8Array(await request.arrayBuffer())
        if (!key.success || !type.success || body.length === 0)
          return error(400, "VALIDATION_ERROR")
        if (body.length > personalMediaMaximumBytes)
          return error(413, "FILE_TOO_LARGE")
        uploads.push({ key: key.data, type: type.data, bytes: body.length })
        uploadedBytes = body
        uploadedContentType = type.data
        return HttpResponse.json(
          PersonalMediaUploadResultSchema.parse({
            operationId: key.data,
            result: "succeeded",
            media: {
              id: uploadedMediaId,
              bytes: body.length,
              contentType: type.data,
              contentUrl: contentUrl(uploadedMediaId),
              createdAt: "2026-10-01T00:00:00Z",
              expiresAt: "2026-10-02T00:00:00Z",
            },
          }),
          { status: 201 }
        )
      }),
      http.put("*/api/v1/personal-media/avatar", async ({ request }) => {
        const input = SetPersonalAvatarSchema.parse(await request.json())
        saves.push(input)
        if (scenario === "slow-save") await delay("infinite")
        if (scenario === "save-conflict" && !saveFailed) {
          saveFailed = true
          return error(409, "VERSION_CONFLICT")
        }
        if (scenario === "save-error") return error(503, "AUDIT_UNAVAILABLE")
        image = input.mediaId ? contentUrl(input.mediaId) : null
        if (scenario === "save-unknown" && !saveFailed) {
          saveFailed = true
          return HttpResponse.error()
        }
        return HttpResponse.json(
          PersonalAvatarResultSchema.parse({
            image,
            changed: true,
            result: "succeeded",
            operationId: "e430c8b4-8de4-4eb4-a0f2-c5017656a703",
          })
        )
      }),
    ],
  }
}
