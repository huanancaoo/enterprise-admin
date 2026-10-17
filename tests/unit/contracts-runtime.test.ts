import { execFileSync } from "node:child_process"
import { describe, expect, it } from "vitest"

function loadedContractModules(path: string) {
  const entry = new URL(
    `../../packages/contracts/dist/${path}`,
    import.meta.url
  )
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      String.raw`
        import { registerHooks } from "node:module"
        const editorModules = new Set()
        const contractModules = new Set()
        registerHooks({
          load(url, context, nextLoad) {
            if (/\/(?:@tiptap|prosemirror-[^/]+)\//.test(url)) editorModules.add(url)
            if (url.includes("/packages/contracts/dist/")) contractModules.add(url.split("/").at(-1))
            return nextLoad(url, context)
          },
        })
        await import(${JSON.stringify(entry.href)})
        console.log(JSON.stringify({ editorModules: [...editorModules], contractModules: [...contractModules].sort() }))
      `,
    ],
    { encoding: "utf8" }
  )
  return JSON.parse(output) as {
    editorModules: string[]
    contractModules: string[]
  }
}

describe("HTTP contract runtime isolation", () => {
  it("does not load editor modules when importing shared contracts", () => {
    expect(loadedContractModules("index.js").editorModules).toEqual([])
  })

  it("loads only error and locale facts for the HTTP error boundary", () => {
    expect(loadedContractModules("api-error.js")).toEqual({
      editorModules: [],
      contractModules: ["api-error.js", "file-errors.js", "locale.js"],
    })
  })

  it("does not load tenant project or integration schemas for the platform", () => {
    expect(loadedContractModules("platform.js").contractModules).toEqual([
      "audit.js",
      "identifiers.js",
      "identity-management.js",
      "locale.js",
      "organizations.js",
      "platform.js",
    ])
  })
})
