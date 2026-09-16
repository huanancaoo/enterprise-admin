import { describe, it, expect } from "vitest"
import {
  COUNTRIES,
  COUNTRY_MAP,
  getCountryFlag,
  getCountryName,
  matchCountry,
} from "../../packages/ui/src/lib/countries"

describe("CountrySelect data and utils", () => {
  it("contains 249 ISO 3166-1 alpha-2 official countries with unique uppercase codes", () => {
    expect(COUNTRIES.length).toBe(249)
    const codeSet = new Set<string>()
    for (const c of COUNTRIES) {
      expect(c.code).toMatch(/^[A-Z]{2}$/)
      expect(c.name.trim()).not.toBe("")
      codeSet.add(c.code)
    }
    expect(codeSet.size).toBe(249)
    expect(COUNTRY_MAP.get("CN")).toBeDefined()
    expect(COUNTRY_MAP.get("US")).toBeDefined()
    expect(COUNTRY_MAP.get("CA")).toBeDefined()
    expect(COUNTRY_MAP.get("SG")).toBeDefined()
  })

  it("converts alpha-2 code to correct Unicode Flag Emoji", () => {
    expect(getCountryFlag("CN")).toBe("🇨🇳")
    expect(getCountryFlag("US")).toBe("🇺🇸")
    expect(getCountryFlag("CA")).toBe("🇨🇦")
    expect(getCountryFlag("SG")).toBe("🇸🇬")
    // Case insensitive
    expect(getCountryFlag("cn")).toBe("🇨🇳")
    expect(getCountryFlag("us")).toBe("🇺🇸")
    // Invalid inputs
    expect(getCountryFlag("")).toBe("")
    expect(getCountryFlag("U")).toBe("")
    expect(getCountryFlag("USA")).toBe("")
    expect(getCountryFlag("12")).toBe("")
  })

  it("resolves localized names via Intl.DisplayNames across supported locales", () => {
    // zh-CN
    expect(getCountryName("CN", "zh-CN")).toBe("中国")
    expect(getCountryName("US", "zh-CN")).toBe("美国")
    expect(getCountryName("CA", "zh-CN")).toBe("加拿大")
    expect(getCountryName("SG", "zh-CN")).toBe("新加坡")

    // en-US
    expect(getCountryName("CN", "en-US")).toBe("China")
    expect(getCountryName("US", "en-US")).toBe("United States")
    expect(getCountryName("CA", "en-US")).toBe("Canada")
    expect(getCountryName("SG", "en-US")).toBe("Singapore")

    // ar (Arabic)
    expect(getCountryName("CN", "ar")).toBe("الصين")
    expect(getCountryName("US", "ar")).toBe("الولايات المتحدة")
    expect(getCountryName("CA", "ar")).toBe("كندا")

    // Unknown code fallback
    expect(getCountryName("XX", "zh-CN")).toBe("XX")
  })

  it("matches search query across code, localized name, english name, aliases, and calling code", () => {
    const us = COUNTRY_MAP.get("US")!
    const cn = COUNTRY_MAP.get("CN")!

    // By ISO code
    expect(matchCountry(us, "US", "美国")).toBe(true)
    expect(matchCountry(us, "us", "美国")).toBe(true)

    // By localized name
    expect(matchCountry(us, "美国", "美国")).toBe(true)
    expect(matchCountry(cn, "中国", "中国")).toBe(true)

    // By English official name
    expect(matchCountry(us, "united", "美国")).toBe(true)
    expect(matchCountry(cn, "china", "中国")).toBe(true)

    // By aliases
    expect(matchCountry(us, "USA", "美国")).toBe(true)
    expect(matchCountry(us, "America", "美国")).toBe(true)
    expect(matchCountry(cn, "PRC", "中国")).toBe(true)

    // By calling code
    expect(matchCountry(us, "+1", "美国")).toBe(true)
    expect(matchCountry(us, "1", "美国")).toBe(true)
    expect(matchCountry(cn, "+86", "中国")).toBe(true)
    expect(matchCountry(cn, "86", "中国")).toBe(true)

    // Negative match
    expect(matchCountry(cn, "Germany", "中国")).toBe(false)
  })
})
