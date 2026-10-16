import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"

const require = createRequire(
  new URL("../../apps/tenant/package.json", import.meta.url)
)

function loadEntry(entry: string, inspect = "undefined") {
  const entryPath = require.resolve(entry)
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        String.raw`
          import { registerHooks } from "node:module"
          import { pathToFileURL } from "node:url"
          const loaded = new Set()
          registerHooks({
            load(url, context, nextLoad) {
              loaded.add(url)
              return nextLoad(url, context)
            },
          })
          const entry = await import(pathToFileURL(${JSON.stringify(entryPath)}))
          console.log(JSON.stringify({ loaded: [...loaded], result: ${inspect} }))
        `,
      ],
      { encoding: "utf8" }
    )
  ) as { loaded: string[]; result?: unknown }
}

function translationFiles(loaded: string[]) {
  return loaded
    .filter((url) => url.includes("/i18n/dist/locales/"))
    .map((url) => url.split("/locales/")[1])
    .sort()
}

describe("i18n runtime entry isolation", () => {
  it("keeps locale and formatting independent of UI, translations and i18next initialization", () => {
    const { loaded, result } = loadEntry(
      "@workspace/i18n",
      'entry.createFormatter("en-US").number(1234)'
    )
    expect(result).toBe("1,234")
    expect(translationFiles(loaded)).toEqual([])
    expect(
      loaded.filter((url) =>
        /\/node_modules\/(?:i18next|react|react-i18next)\//.test(url)
      )
    ).toEqual([])
    expect(
      loaded.filter((url) =>
        /\/i18n\/dist\/(?:config|resources|server|email|email-catalog|task-email-catalog)\.js$/.test(
          url
        )
      )
    ).toEqual([])
  })

  it("loads only error translations for server requests", () => {
    const { loaded, result } = loadEntry(
      "@workspace/i18n/server",
      'entry.getTranslator("ar")("FORBIDDEN")'
    )
    expect(result).toBe("الوصول غير مسموح")
    expect(translationFiles(loaded)).toEqual([
      "ar/errors.json",
      "en-US/errors.json",
      "zh-CN/errors.json",
    ])
    expect(
      loaded.filter((url) =>
        /\/node_modules\/(?:react|react-i18next)\//.test(url)
      )
    ).toEqual([])
  })

  it("loads email copy without initializing UI or server translators", () => {
    const { loaded, result } = loadEntry(
      "@workspace/i18n/email",
      'entry.emailCatalog["password-reset"]["en-US"].subject'
    )
    expect(result).toBe("Reset your password")
    expect(translationFiles(loaded)).toEqual([])
    expect(
      loaded.filter((url) => /\/node_modules\/i18next\//.test(url))
    ).toEqual([])
  })

  it("uses built React helpers without importing the UI catalog", () => {
    const { loaded } = loadEntry("@workspace/i18n/react")
    expect(translationFiles(loaded)).toEqual([])
    expect(loaded.filter((url) => /\/i18n\/src\//.test(url))).toEqual([])
    expect(
      loaded.filter((url) =>
        /\/i18n\/dist\/(?:config|resources|server|email)\.js$/.test(url)
      )
    ).toEqual([])
  })
})
