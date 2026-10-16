import { execFileSync } from "node:child_process"
import { describe, expect, it } from "vitest"

function inspectEntry(entry: string, exercise = "") {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `
        import { registerHooks } from "node:module"
        const modules = new Set()
        registerHooks({
          load(url, context, nextLoad) {
            if (url.startsWith("file:")) modules.add(url)
            return nextLoad(url, context)
          },
        })
        const entry = await import(${JSON.stringify(entry)})
        ${exercise}
        console.log(JSON.stringify([...modules]))
      `,
      ],
      { encoding: "utf8" }
    )
  ) as string[]
}

const codecs = /\/node_modules\/(?:exceljs|csv-parse|csv-stringify)\//

describe("task runtime entrypoint isolation", () => {
  it("does not load business tasks or file codecs through the generic runtime", () => {
    const modules = inspectEntry(
      new URL("../dist/index.js", import.meta.url).href
    )
    expect(modules.filter((url) => codecs.test(url))).toEqual([])
    expect(
      modules.filter((url) =>
        /\/jobs\/dist\/(?:project-exchange|business-task-)/.test(url)
      )
    ).toEqual([])
  })

  it("validates project admission without loading worker execution or file codecs", () => {
    const modules = inspectEntry(
      new URL("../dist/project-exchange.js", import.meta.url).href,
      `
      const { createTaskEnvelope } = await import(${JSON.stringify(new URL("../dist/index.js", import.meta.url).href)})
      for (const type of ["projects.import", "projects.export"]) {
        createTaskEnvelope(entry.projectExchangeTasks, {
          type,
          identity: {
            organizationId: "69cd25f0-f8f1-4af3-a369-1ab953ae659f",
            actorId: "72388412-809d-4a96-8434-0da470d0c456",
            resourceId: "4dc6f734-607b-4729-966c-8dd021d4fe7c",
            locale: "en-US",
            requestId: "admission",
          },
          idempotencyKey: type,
          input: type === "projects.import"
            ? { format: "csv", contentBase64: "bmFtZSxkZXNjcmlwdGlvbixjb250ZW50TG9jYWxlCg==" }
            : { format: "xlsx", filter: {} },
        })
      }
      `
    )
    expect(modules.filter((url) => codecs.test(url))).toEqual([])
    expect(
      modules.filter((url) => /\/project-exchange-execution\.js$/.test(url))
    ).toEqual([])
  })
})
