import { describe, expect, it } from "vitest"
import { authErrorMessage } from "../../packages/admin/src/auth/auth-error"
import { createAuthI18n } from "../../packages/database/src/auth-i18n"

describe("Auth i18n error handling", () => {
  it("前端直接展示服务端返回的本地化 error.message", () => {
    const error = {
      code: "INVALID_EMAIL_OR_PASSWORD",
      message: "邮箱或密码无效",
      status: 400,
    }
    expect(authErrorMessage(error, "操作未成功，请重试。")).toBe(
      "邮箱或密码无效"
    )
  })

  it("当服务端未返回有效 message 时使用通用失败文案", () => {
    const fallback = "操作未成功，请重试。"
    expect(authErrorMessage({}, fallback)).toBe(fallback)
    expect(authErrorMessage({ message: "   " }, fallback)).toBe(fallback)
    expect(authErrorMessage({ status: 500 }, fallback)).toBe(fallback)
  })

  it("只注册产品三语，并按完整语言标签协商", async () => {
    const plugin = createAuthI18n() as {
      id: string
      options: {
        defaultLocale: string
        detection: string[]
        translations: Record<string, Record<string, string>>
        getLocale: (ctx: {
          headers?: Headers
          context: { session?: { user?: { preferredLocale?: string } } }
        }) => string | null | Promise<string | null>
      }
    }
    expect(plugin.id).toBe("i18n")
    expect(plugin.options.defaultLocale).toBe("zh-CN")
    expect(plugin.options.detection).toEqual(["callback"])
    expect(Object.keys(plugin.options.translations).sort()).toEqual([
      "ar",
      "en-US",
      "zh-CN",
    ])
    expect(plugin.options.translations["zh-CN"]?.ORGANIZATION_SUSPENDED).toBe(
      "该组织已停用"
    )
    expect(plugin.options.translations["en-US"]?.ORGANIZATION_SUSPENDED).toBe(
      "This organization is suspended"
    )
    expect(plugin.options.translations.ar?.ORGANIZATION_SUSPENDED).toBe(
      "هذه المؤسسة موقوفة"
    )
    expect(
      plugin.options.translations["zh-CN"]?.INVALID_EMAIL_OR_PASSWORD
    ).toBe("邮箱或密码无效")

    expect(
      await plugin.options.getLocale({
        headers: new Headers({ "accept-language": "en-US" }),
        context: {},
      })
    ).toBe("en-US")
    expect(
      await plugin.options.getLocale({
        headers: new Headers({ "accept-language": "fr,en-US;q=0.8" }),
        context: {},
      })
    ).toBe("en-US")
    expect(
      await plugin.options.getLocale({
        headers: new Headers({ "accept-language": "fr" }),
        context: {},
      })
    ).toBe("zh-CN")
    expect(
      await plugin.options.getLocale({
        headers: new Headers({ "accept-language": "fr" }),
        context: { session: { user: { preferredLocale: "ar" } } },
      })
    ).toBe("ar")
  })
})
