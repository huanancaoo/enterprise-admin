import { expect, it } from "vitest"
import { TaskPermanentError, taskErrorCode } from "../src/index.ts"
it("distinguishes explicit permanent task errors from transient failures without leaking messages", () => {
  expect(taskErrorCode(new TaskPermanentError("RESOURCE_DENIED"))).toBe(
    "RESOURCE_DENIED"
  )
  expect(taskErrorCode(new Error("password=private"))).toBeUndefined()
})
