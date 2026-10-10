import { describe, expect, it } from "vitest"
import { z } from "zod"
import { createTaskEnvelope, defineTask, taskJobId } from "../src/index.ts"

const identity = {
  organizationId: "2a5e0ba1-1aa5-4fbd-8517-8c0131e3039c",
  actorId: "a7a151a7-1c98-40ce-9b63-0f22d2cf1d96",
  resourceId: "c15a774b-815f-46ee-a1c3-6bde011f6650",
  locale: "zh-CN" as const,
  requestId: "request-a",
}
const task = defineTask({
  type: "fixture.write",
  inputSchema: z.strictObject({ name: z.string().trim().min(1) }),
  permissions: { project: ["create"] },
  authorizeResource: async () => {},
  findCommitted: async () => undefined,
  execute: async () => ({ ok: true }),
})

describe("registered task contract", () => {
  it("compares normalized business intent while preserving the original request correlation", () => {
    const first = createTaskEnvelope([task], {
      type: task.type,
      identity,
      idempotencyKey: "one",
      input: { name: " hello " },
    })
    const repeat = createTaskEnvelope([task], {
      type: task.type,
      identity: { ...identity, requestId: "request-b" },
      idempotencyKey: "one",
      input: { name: "hello" },
    })
    expect(first.input).toEqual({ name: "hello" })
    expect(first.intentFingerprint).toBe(repeat.intentFingerprint)
    expect(first.identity.requestId).toBe("request-a")
  })
  it("keeps the same queue identity across request retries and separates actors", () => {
    const id = taskJobId(identity, "fixture.write", "one")
    expect(id).toMatch(/^[a-f0-9]{64}$/)
    expect(
      taskJobId({ ...identity, requestId: "request-b" }, "fixture.write", "one")
    ).toBe(id)
    expect(
      taskJobId(
        { ...identity, actorId: identity.resourceId },
        "fixture.write",
        "one"
      )
    ).not.toBe(id)
  })
})
