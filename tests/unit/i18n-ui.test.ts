import { describe, it, expect } from "vitest"
import {
  createFormatter,
  createUiI18n,
  getTranslator,
  syncDocumentLanguage,
  resources,
  supportedLocales,
} from "../../packages/i18n/src/index"

describe("UI locale and formatting", () => {
  it("keeps browser instances and server translators independent", async () => {
    const first = createUiI18n("zh-CN")
    const second = createUiI18n("en-US")
    const server = getTranslator("en-US")
    await first.changeLanguage("ar")
    expect(first.t("save")).toBe("حفظ")
    expect(second.t("save")).toBe("Save")
    expect(server("FORBIDDEN")).toBe("Access denied")
  })
  it("synchronizes and detaches document language listeners", async () => {
    const instance = createUiI18n()
    const root = { lang: "", dir: "" }
    const detach = syncDocumentLanguage(instance, {
      documentElement: root,
    } as unknown as Document)
    expect(root).toEqual({ lang: "zh-CN", dir: "ltr" })
    await instance.changeLanguage("ar")
    expect(root).toEqual({ lang: "ar", dir: "rtl" })
    await instance.changeLanguage("en-US")
    expect(root).toEqual({ lang: "en-US", dir: "ltr" })
    detach()
    await instance.changeLanguage("ar")
    expect(root.lang).toBe("en-US")
  })
  it("does not derive a time zone or currency from the UI locale", () => {
    const timestamp = new Date("2026-09-15T23:30:00Z")
    const format = createFormatter("en-US")
    expect(format.dateTime(timestamp, "UTC")).toBe("9/15/2026")
    expect(format.dateTime(timestamp, "Asia/Shanghai")).toBe("9/16/2026")
    expect(format.currency(12, "USD")).toBe("$12.00")
    expect(format.currency(12, "EUR")).toBe("€12.00")
    expect(format.percent(0.25)).toBe("25%")
    expect(format.relativeTime(-1, "day", { numeric: "auto" })).toBe(
      "yesterday"
    )
    expect(createFormatter("ar").number(1234)).toBe(
      new Intl.NumberFormat("ar").format(1234)
    )
  })
  it("ships all six namespaces with the same non-empty keys in every locale", () => {
    for (const locale of supportedLocales) {
      expect(Object.keys(resources[locale]).sort()).toEqual([
        "auth",
        "common",
        "errors",
        "organization",
        "projects",
        "validation",
      ])
      for (const namespace of Object.keys(resources["zh-CN"]) as Array<
        keyof (typeof resources)["zh-CN"]
      >) {
        const catalog = resources[locale][namespace]
        expect(Object.keys(catalog).sort()).toEqual(
          Object.keys(resources["zh-CN"][namespace]).sort()
        )
        for (const value of Object.values(catalog))
          expect(value.trim()).not.toBe("")
      }
    }
  })
})
