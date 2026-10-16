import { useTranslation } from "react-i18next"
import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, within, waitFor } from "storybook/test"
import {
  AuthenticatedSessionProvider,
  createWorkspaceAuthClient,
} from "@workspace/admin/auth"
import {
  createProjectExchangeScenario,
  taskCenterOrganizationId,
  taskCenterUser,
} from "@workspace/mocks"
import { ProjectListQuerySchema } from "@workspace/contracts/project-query"
import { ProjectExchangeActions } from "./project-exchange"
function selectFile(input: HTMLInputElement, file: File) {
  // 原生 FileList 同时更新 required 的浏览器有效性，不能只模拟 files 属性。
  const transfer = new DataTransfer()
  transfer.items.add(file)
  input.files = transfer.files
  input.dispatchEvent(new Event("change", { bubbles: true }))
}
function ExchangeStory() {
  const { t } = useTranslation("tasks")
  const [client] = useState(createWorkspaceAuthClient)
  const [accepted, setAccepted] = useState(false)
  return (
    <AuthenticatedSessionProvider client={client} user={taskCenterUser}>
      <ProjectExchangeActions
        organizationId={taskCenterOrganizationId}
        filter={ProjectListQuerySchema.parse({
          page: 3,
          pageSize: 20,
          name: "Applied filter",
          status: "active",
          sortBy: "updatedAt",
          sortOrder: "asc",
        })}
        onTaskCreated={() => setAccepted(true)}
      />
      {accepted && <p role="status">{t("submitted")}</p>}
    </AuthenticatedSessionProvider>
  )
}
const fixture = createProjectExchangeScenario()
const meta = {
  title: "Admin/Project import export",
  component: ExchangeStory,
  globals: { locale: "en-US" },
  beforeEach: fixture.reset,
  parameters: { msw: { handlers: fixture.handlers } },
} satisfies Meta<typeof ExchangeStory>
export default meta
type Story = StoryObj<typeof meta>
export const SubmitsAtomicCsvImport: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole("button", { name: "Import projects" })
    )
    const dialog = await within(canvasElement.ownerDocument.body).findByRole(
      "dialog"
    )
    await expect(
      within(dialog).getByText(
        "Only new projects are added. All rows must pass validation before any project is saved."
      )
    ).toBeVisible()
    const file = new File(
      ["name,description,contentLocale\nImported,Example,en-US\n"],
      "projects.csv",
      { type: "text/csv" }
    )
    selectFile(within(dialog).getByLabelText<HTMLInputElement>("File"), file)
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Submit import" })
    )
    await expect(await canvas.findByText("Submitted")).toBeVisible()
    await waitFor(() => expect(fixture.requests).toHaveLength(1))
    expect(fixture.requests[0].body).toEqual({
      format: "csv",
      contentBase64: btoa(await file.text()),
    })
    expect(fixture.requests[0].key).toMatch(/^[0-9a-f-]{36}$/)
  },
}
export const ExportsAppliedFilterAcrossAllPages: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole("button", { name: "Export projects" })
    )
    const dialog = await within(canvasElement.ownerDocument.body).findByRole(
      "dialog"
    )
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Submit export" })
    )
    await expect(await canvas.findByText("Submitted")).toBeVisible()
    expect(fixture.requests[0].body).toEqual({
      format: "csv",
      filter: {
        name: "Applied filter",
        status: "active",
        sortBy: "updatedAt",
        sortOrder: "asc",
      },
    })
    expect(fixture.requests[0].locale).toBe("en-US")
  },
}
export const RejectsOversizedFileBeforeSubmitting: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole("button", { name: "Import projects" })
    )
    const dialog = await within(canvasElement.ownerDocument.body).findByRole(
      "dialog"
    )
    const input = within(dialog).getByLabelText<HTMLInputElement>("File")
    selectFile(
      input,
      new File([new Uint8Array(10_000_001)], "oversized.csv", {
        type: "text/csv",
      })
    )
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Submit import" })
    )
    // 错误节点可能在弹窗入场动画结束前挂载，断言需等待实际可见。
    await waitFor(() =>
      expect(within(dialog).getByText("The file exceeds 10 MB.")).toBeVisible()
    )
    await expect(input).toHaveAttribute("aria-invalid", "true")
    expect(fixture.requests).toHaveLength(0)
  },
}
export const SelectsXlsxAndSubmitsExactBytes: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole("button", { name: "Import projects" })
    )
    const body = within(canvasElement.ownerDocument.body)
    const dialog = await body.findByRole("dialog")
    await userEvent.click(
      within(dialog).getByRole("combobox", { name: "Format" })
    )
    await userEvent.click(await body.findByRole("option", { name: "XLSX" }))
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x80, 0xff])
    const file = new File([bytes], "projects.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
    selectFile(within(dialog).getByLabelText<HTMLInputElement>("File"), file)
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Submit import" })
    )
    await expect(await canvas.findByText("Submitted")).toBeVisible()
    expect(fixture.requests[0].body).toEqual({
      format: "xlsx",
      contentBase64: btoa(String.fromCharCode(...bytes)),
    })
  },
}
