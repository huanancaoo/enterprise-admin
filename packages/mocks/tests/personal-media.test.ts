import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { setupServer } from "msw/node"
import {
  ApiErrorSchema,
  PersonalMediaUploadResultSchema,
  PersonalAvatarResultSchema,
} from "@workspace/contracts"
import { createPersonalAvatarScenario, personalAvatarImage } from "../src/index"

const server = setupServer()
const base = "http://mock.test/api/v1/personal-media"
beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe("personal avatar Storybook contracts", () => {
  it("receives raw image bytes and a UUID header and exposes safe upload/CAS receipts", async () => {
    const fixture = createPersonalAvatarScenario()
    server.use(...fixture.handlers)
    const key = "e430c8b4-8de4-4eb4-a0f2-c5017656a799"
    const response = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "image/png", "Idempotency-Key": key },
      body: new Blob([personalAvatarImage]),
    })
    expect(response.status).toBe(201)
    const uploaded = PersonalMediaUploadResultSchema.parse(
      await response.json()
    )
    expect(uploaded.operationId).toBe(key)
    expect(fixture.snapshot().uploads).toEqual([
      { key, type: "image/png", bytes: personalAvatarImage.length },
    ])
    const saved = await fetch(base + "/avatar", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mediaId: uploaded.media.id,
        expectedImage: fixture.user.image,
        idempotencyKey: key,
      }),
    })
    expect(PersonalAvatarResultSchema.parse(await saved.json()).image).toBe(
      uploaded.media.contentUrl
    )
    const content = await fetch("http://mock.test" + uploaded.media.contentUrl)
    expect(new Uint8Array(await content.arrayBuffer())).toEqual(
      personalAvatarImage
    )
  })
  it.each([
    ["upload-error", 503, "FILE_STORAGE_UNAVAILABLE"],
    ["unauthorized", 401, "UNAUTHENTICATED"],
  ] as const)("returns formal %s errors", async (scenario, status, code) => {
    server.use(...createPersonalAvatarScenario(scenario).handlers)
    const response = await fetch(base, {
      method: "POST",
      body: new Blob([personalAvatarImage]),
    })
    expect(response.status).toBe(status)
    expect(ApiErrorSchema.parse(await response.json()).code).toBe(code)
  })
})
