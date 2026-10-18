import { stat } from "node:fs/promises"
import ExcelJS from "exceljs"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  assertOrganizationExportCapacity,
  MAX_ORGANIZATION_EXPORT_ROWS,
  writeOrganizationExportArtifact,
} from "../src/organization-export-artifact.ts"
import { MAX_PLATFORM_EXPORT_ROWS } from "../src/platform-exchange.ts"

const temporary = vi.hoisted(() => ({ paths: [] as string[] }))
vi.mock("node:fs/promises", async (load) => {
  const actual = await load<typeof import("node:fs/promises")>()
  return {
    ...actual,
    mkdtemp: async (prefix: string) => {
      const path = await actual.mkdtemp(prefix)
      temporary.paths.push(path)
      return path
    },
  }
})
beforeEach(() => {
  temporary.paths = []
})
async function expectRemoved() {
  expect(temporary.paths).toHaveLength(1)
  await expect(stat(temporary.paths[0]!)).rejects.toMatchObject({
    code: "ENOENT",
  })
}
describe("private streaming organization export artifact", () => {
  it("writes usable XLSX without materializing rows and removes the private directory", async () => {
    let inspected = false
    async function* rows() {
      yield ["=SUM(1,2)", "مرحبا"]
      const directory = temporary.paths[0]!
      expect((await stat(directory)).mode & 0o777).toBe(0o700)
      // 文件流异步打开；在继续消费后续行前验证实际私有文件权限。
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect((await stat(`${directory}/result.xlsx`)).mode & 0o777).toBe(0o600)
      inspected = true
      for (let row = 1; row < 2001; row++) yield [`row-${row}`, `value-${row}`]
    }
    const artifact = await writeOrganizationExportArtifact({
      title: "Members",
      columns: ["name", "value"],
      rows: rows(),
    })
    expect(inspected).toBe(true)
    expect(artifact.count).toBe(2001)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(
      Uint8Array.from(Buffer.from(artifact.contentBase64, "base64")).buffer
    )
    expect(workbook.worksheets[0]!.rowCount).toBe(2002)
    expect(workbook.worksheets[0]!.getCell("A2").value).toBe("=SUM(1,2)")
    expect(workbook.worksheets[0]!.getCell("B2").value).toBe("مرحبا")
    expect(workbook.worksheets[0]!.getCell("A2002").value).toBe("row-2000")
    await expectRemoved()
  })
  it("shares the exact Excel technical limit with platform and rejects an extra row", () => {
    expect(MAX_ORGANIZATION_EXPORT_ROWS).toBe(MAX_PLATFORM_EXPORT_ROWS)
    expect(MAX_ORGANIZATION_EXPORT_ROWS).toBe(1_048_575)
    expect(() => assertOrganizationExportCapacity(1_048_575)).not.toThrow()
    expect(() => assertOrganizationExportCapacity(1_048_576)).toThrow(
      "TOO_MANY_ROWS"
    )
  })
  it("rejects a streaming row-limit overrun entirely and cleans partial artifacts", async () => {
    async function* rows() {
      yield ["one"]
      yield ["two"]
      yield ["three"]
    }
    await expect(
      writeOrganizationExportArtifact({
        title: "Logs",
        columns: ["value"],
        rows: rows(),
        rowLimit: 2,
      })
    ).rejects.toMatchObject({ code: "TOO_MANY_ROWS" })
    await expectRemoved()
  })
  it("cleans the temporary artifact when a later source page fails", async () => {
    async function* rows() {
      yield ["first-page"]
      throw new Error("SOURCE_READ_FAILED")
    }
    await expect(
      writeOrganizationExportArtifact({
        title: "Logs",
        columns: ["value"],
        rows: rows(),
      })
    ).rejects.toThrow("SOURCE_READ_FAILED")
    await expectRemoved()
  })
})
