import { describe, expect, it } from "vitest"
import { resolveLocale, getTranslator } from "../../packages/i18n/src/index"

describe("Locale negotiation", () => {
  it("Header → user → organization → platform", () => {
    expect(
      resolveLocale({
        acceptLanguage: "ar",
        preferredLocale: "en-US",
        defaultLocale: "zh-CN",
      })
    ).toBe("ar")
    expect(
      resolveLocale({
        acceptLanguage: "fr",
        preferredLocale: "en-US",
        defaultLocale: "ar",
      })
    ).toBe("en-US")
    expect(resolveLocale({ defaultLocale: "ar" })).toBe("ar")
    expect(resolveLocale({})).toBe("zh-CN")
  })
  it("权重、同权顺序、大小写与显式支持范围", () => {
    expect(
      resolveLocale({ acceptLanguage: "zh-CN;q=0.2,ar;q=0.8,en-US;q=0.8" })
    ).toBe("ar")
    expect(resolveLocale({ acceptLanguage: "EN-us" })).toBe("en-US")
    expect(
      resolveLocale({
        acceptLanguage: "ar;q=0,en-US;q=2,*,en-GB",
        preferredLocale: "zh-CN",
      })
    ).toBe("zh-CN")
  })
  it("并发的固定translator不串语言", async () => {
    const zh = getTranslator("zh-CN"),
      en = getTranslator("en-US"),
      ar = getTranslator("ar")
    const results = await Promise.all(
      Array.from({ length: 30 }, async (_, i) =>
        [zh, en, ar][i % 3]!("FORBIDDEN")
      )
    )
    expect(results.slice(0, 3)).toEqual([
      "无权访问此资源",
      "Access denied",
      "الوصول غير مسموح",
    ])
    for (let i = 3; i < results.length; i++)
      expect(results[i]).toBe(results[i % 3])
  })
})
