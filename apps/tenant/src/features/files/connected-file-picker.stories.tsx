import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import {
  createFilePickerScenario,
  filePickerRoot,
  filePickerFolder,
  filePickerImage,
} from "@workspace/mocks"
import { Button } from "@workspace/ui/components/button"
import {
  ConnectedFilePickerDialog,
  ConnectedFolderPickerDialog,
} from "./connected-file-picker"
import { fileKeys } from "./file-queries"

function PickerFixture({
  mode = "file",
  pendingPick = false,
  deny,
}: {
  mode?: "file" | "folder"
  pendingPick?: boolean
  deny?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [version, setVersion] = useState(1)
  const [picked, setPicked] = useState("")
  const [aborted, setAborted] = useState(false)
  const client = useQueryClient()
  const context = {
    organizationId: filePickerRoot.organizationId,
    authorizationVersion: version,
    contentScopeKey: `user:organization:${version}`,
    root: filePickerRoot,
    open,
    onOpenChange: setOpen,
  }
  // 英文驱动只用于验证选择协议，产品文案来自真实的三语组件。
  // i18next-instrument-ignore
  return (
    <main className="space-y-4 p-6">
      <Button onClick={() => setOpen(true)}>Open picker</Button>
      <output aria-label="Picked reference">{picked}</output>
      <output aria-label="Aborted request">{String(aborted)}</output>
      {mode === "folder" ? (
        <ConnectedFolderPickerDialog
          {...context}
          canPick={(folder) => folder.id !== filePickerRoot.id}
          onPick={async (folder) => setPicked(folder.id)}
        />
      ) : (
        <ConnectedFilePickerDialog
          {...context}
          allowedContentTypes={["image/png"]}
          uploadControl={
            <div className="flex gap-2">
              <Button onClick={() => setVersion((current) => current + 1)}>
                Change authorization
              </Button>
              {deny && (
                <Button
                  onClick={() => {
                    deny()
                    void client.invalidateQueries({
                      queryKey: fileKeys.scope(filePickerRoot.organizationId),
                    })
                  }}
                >
                  Revoke reads
                </Button>
              )}
            </div>
          }
          onPick={async (reference, signal) => {
            if (pendingPick) {
              await new Promise<void>((resolve) =>
                signal.addEventListener(
                  "abort",
                  () => {
                    setAborted(true)
                    resolve()
                  },
                  { once: true }
                )
              )
            }
            if (!signal.aborted) setPicked(JSON.stringify(reference))
          }}
        />
      )}
    </main>
  )
}

function scenario(
  name: Parameters<typeof createFilePickerScenario>[0] = "success"
) {
  const fixture = createFilePickerScenario(name)
  return {
    fixture,
    beforeEach: fixture.reset,
    parameters: { msw: { handlers: fixture.handlers } },
  }
}
const normal = scenario()
const meta = {
  title: "Tenant/Connected file picker",
  component: PickerFixture,
  globals: { locale: "en-US" },
  beforeEach: normal.beforeEach,
  parameters: normal.parameters,
} satisfies Meta<typeof PickerFixture>
export default meta
type Story = StoryObj<typeof meta>

async function open(canvasElement: HTMLElement) {
  await userEvent.click(
    within(canvasElement).getByRole("button", { name: "Open picker" })
  )
  return within(await within(document.body).findByRole("dialog"))
}
async function chooseImage(dialog: ReturnType<typeof within>) {
  await userEvent.click(await dialog.findByRole("button", { name: "Manuals" }))
  await userEvent.click(
    await dialog.findByRole("button", { name: "portrait.png" })
  )
}
export const FolderBrowseAndVersionReference: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    await expect(
      await dialog.findByRole("button", { name: "Report 01.pdf" })
    ).toBeDisabled()
    await chooseImage(dialog)
    await userEvent.click(dialog.getByRole("button", { name: "Use file" }))
    await waitFor(() =>
      expect(within(document.body).queryByRole("dialog")).toBeNull()
    )
    await expect(
      within(canvasElement).getByLabelText("Picked reference")
    ).toHaveTextContent(
      JSON.stringify({
        fileId: filePickerImage.id,
        versionId: filePickerImage.currentVersion.id,
      })
    )
    await expect(
      normal.fixture.searches.some(
        (query) => query.parentId === filePickerFolder.id
      )
    ).toBe(true)
    await expect(
      normal.fixture.headers.every((value) => value === "en-US")
    ).toBe(true)
  },
}
export const ServerPaginationAndOrganizationSearch: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    await dialog.findByRole("button", { name: "Manuals" })
    await userEvent.click(dialog.getByRole("button", { name: "Next page" }))
    await expect(
      await dialog.findByRole("button", { name: "Report 23.pdf" })
    ).toBeDisabled()
    await expect(
      normal.fixture.searches.some(
        (query) => query.page === 2 && query.pageSize === 20
      )
    ).toBe(true)
    const search = dialog.getByRole("textbox", {
      name: "Search files and folders in this organization",
    })
    await userEvent.type(search, "portrait")
    await userEvent.keyboard("{Enter}")
    await userEvent.click(
      await dialog.findByRole("button", { name: "portrait.png" })
    )
    await expect(dialog.getByRole("button", { name: "Use file" })).toBeEnabled()
    await expect(
      normal.fixture.searches.some(
        (query) => query.name === "portrait" && query.page === 1
      )
    ).toBe(true)
  },
}
export const DirectoryTargetsOnly: Story = {
  args: { mode: "folder" },
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    await dialog.findByRole("button", { name: "Manuals" })
    await expect(
      dialog.getByRole("button", { name: "Use this folder" })
    ).toBeDisabled()
    await userEvent.click(dialog.getByRole("button", { name: "Manuals" }))
    await expect(
      await dialog.findByRole("button", { name: "portrait.png" })
    ).toBeDisabled()
    await userEvent.click(
      dialog.getByRole("button", { name: "Use this folder" })
    )
    await expect(
      within(canvasElement).getByLabelText("Picked reference")
    ).toHaveTextContent(filePickerFolder.id)
  },
}
const forbidden = scenario("forbidden")
export const DeniedQueriesCannotConfirm: Story = {
  beforeEach: forbidden.beforeEach,
  parameters: forbidden.parameters,
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    await waitFor(() =>
      expect(dialog.getByRole("button", { name: "Use file" })).toBeDisabled()
    )
    await waitFor(() => expect(dialog.getByText(/permission/i)).toBeVisible())
    await expect(dialog.queryByRole("button", { name: "Manuals" })).toBeNull()
  },
}
const revoked = scenario()
export const RevocationClearsSelection: Story = {
  args: { deny: revoked.fixture.deny },
  beforeEach: revoked.beforeEach,
  parameters: revoked.parameters,
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    await chooseImage(dialog)
    await userEvent.click(dialog.getByRole("button", { name: "Revoke reads" }))
    await waitFor(() =>
      expect(dialog.getByRole("button", { name: "Use file" })).toBeDisabled()
    )
    await waitFor(() => expect(dialog.getByText(/permission/i)).toBeVisible())
    await expect(dialog.getByRole("status")).not.toHaveTextContent(
      "portrait.png"
    )
  },
}
export const AuthorizationChangeAbortsPendingPick: Story = {
  args: { pendingPick: true },
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    await chooseImage(dialog)
    await userEvent.click(dialog.getByRole("button", { name: "Use file" }))
    await userEvent.click(
      dialog.getByRole("button", { name: "Change authorization" })
    )
    await waitFor(() =>
      expect(
        within(canvasElement).getByLabelText("Aborted request")
      ).toHaveTextContent("true")
    )
    await expect(
      within(canvasElement).getByLabelText("Picked reference")
    ).toBeEmptyDOMElement()
    await expect(
      within(document.body).getByRole("button", { name: "Use file" })
    ).toBeDisabled()
  },
}
export const ChineseKeyboardPick: Story = {
  globals: { locale: "zh-CN" },
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    await chooseImage(dialog)
    await waitFor(() =>
      expect(dialog.getByRole("button", { name: "使用文件" })).toBeEnabled()
    )
    const confirm = dialog.getByRole("button", { name: "使用文件" })
    for (let step = 0; document.activeElement !== confirm && step < 30; step++)
      await userEvent.tab()
    await expect(confirm).toHaveFocus()
    await userEvent.keyboard("{Enter}")
    await waitFor(() =>
      expect(
        within(canvasElement).getByLabelText("Picked reference")
      ).toHaveTextContent(filePickerImage.currentVersion.id)
    )
    await expect(
      normal.fixture.headers.every((value) => value === "zh-CN")
    ).toBe(true)
  },
}
export const ArabicKeyboardPick: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    await expect(document.documentElement).toHaveAttribute("dir", "rtl")
    await chooseImage(dialog)
    await waitFor(() =>
      expect(
        dialog.getByRole("button", { name: "استخدام الملف" })
      ).toBeEnabled()
    )
    const confirm = dialog.getByRole("button", { name: "استخدام الملف" })
    for (let step = 0; document.activeElement !== confirm && step < 30; step++)
      await userEvent.tab()
    await expect(confirm).toHaveFocus()
    await userEvent.keyboard("{Enter}")
    await waitFor(() =>
      expect(
        within(canvasElement).getByLabelText("Picked reference")
      ).toHaveTextContent(filePickerImage.currentVersion.id)
    )
    await expect(normal.fixture.headers.every((value) => value === "ar")).toBe(
      true
    )
  },
}
