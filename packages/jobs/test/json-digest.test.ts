import { describe, expect, it } from "vitest"
import { canonicalJsonHash } from "../src/index.ts"

const input = { z: 1, A: { é: 2, _: 3, a: 4 }, a: [{ Z: null, a: true }] }

describe("persisted JSON digest protocols", () => {
  it.each([
    [
      "locale",
      "036d635975756c7bea09d258a4bed294080505205658e2129a7a3639e1924785",
    ],
    [
      "code-unit",
      "da0e498e95a8cd2e89636038d43a2b92ac2f3af227dd294210df3b6666ef30d1",
    ],
  ] as const)("preserves the existing %s digest bytes", (order, digest) => {
    // 固定向量来自抽取前实现；两种已有协议不能因共享工具而重新编码。
    expect(canonicalJsonHash(input, order)).toBe(digest)
    expect(canonicalJsonHash({ a: input.a, z: 1, A: input.A }, order)).toBe(
      digest
    )
  })
})
