import { useRef, useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import {
  FileResponseSchema,
  FolderResponseSchema,
  maxOrganizationUploadBytes,
} from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import {
  UploadSelectionDialog,
  type FileUploadSelection,
} from "./upload-selection-dialog"

const id = (value: number) =>
  `18b09a98-1cfa-4b40-8c1a-${String(value).padStart(12, "0")}`
const parent = FolderResponseSchema.parse({
  kind: "folder",
  id: id(1),
  organizationId: id(2),
  parentId: id(3),
  name: "Manuals",
  path: ["Manuals"],
  revision: 1,
  state: "active",
  operationId: null,
  deletedAt: null,
  expiresAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
})
const target = FileResponseSchema.parse({
  ...parent,
  kind: "file",
  id: id(4),
  parentId: parent.id,
  name: "Existing.txt",
  path: ["Manuals", "Existing.txt"],
  revision: 3,
  currentVersion: {
    id: id(5),
    fileId: id(4),
    bytes: 10,
    contentType: "text/plain",
    sha256: "0".repeat(64),
    previewKind: "text",
    isCurrent: true,
    createdAt: parent.createdAt,
    retiredAt: null,
    expiresAt: null,
  },
})

function SelectionFixture({
  overwrite = false,
  canSubmit = true,
  mode = "complete",
}: {
  overwrite?: boolean
  canSubmit?: boolean
  mode?: "complete" | "failure" | "pending" | "scopeChange"
}) {
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState("user:organization:1")
  const [submitted, setSubmitted] = useState<FileUploadSelection[][]>([])
  const [aborted, setAborted] = useState(false)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const register = async (
    items: FileUploadSelection[],
    signal: AbortSignal
  ) => {
    setSubmitted((current) => [...current, items])
    if (mode === "pending" || mode === "scopeChange") {
      const canceled = new Promise<void>((resolve) =>
        signal.addEventListener(
          "abort",
          () => {
            setAborted(true)
            resolve()
          },
          { once: true }
        )
      )
      if (mode === "scopeChange") setScope("user:organization:2")
      await canceled
    }
    if (mode === "failure" && submitted.length === 0)
      throw new Error("Storage access failed")
  }
  // i18next-instrument-ignore
  return (
    <div className="p-6">
      <Button ref={trigger} onClick={() => setOpen(true)}>
        Open selection
      </Button>
      <output aria-label="Registered selections">
        {JSON.stringify(
          submitted.map((items) =>
            items.map(({ file, name }) => ({
              name,
              fileName: file.name,
              bytes: file.size,
              type: file.type,
            }))
          )
        )}
      </output>
      <output aria-label="Registration canceled">{String(aborted)}</output>
      <UploadSelectionDialog
        {...(overwrite
          ? { kind: "overwrite" as const, target }
          : { kind: "upload" as const, parent })}
        open={open}
        contentScopeKey={scope}
        canSubmit={canSubmit}
        onSubmit={register}
        onClose={() => setOpen(false)}
        returnFocus={() => trigger.current}
      />
    </div>
  )
}
const meta = {
  title: "Tenant/Upload selection",
  component: SelectionFixture,
  globals: { locale: "en-US" },
} satisfies Meta<typeof SelectionFixture>
export default meta
type Story = StoryObj<typeof meta>
async function open(canvasElement: HTMLElement) {
  await userEvent.click(
    within(canvasElement).getByRole("button", { name: "Open selection" })
  )
  const dialog = await within(canvasElement.ownerDocument.body).findByRole(
    "dialog"
  )
  await waitFor(() => expect(dialog).toBeVisible())
  return within(dialog)
}
function requests(canvasElement: HTMLElement) {
  return JSON.parse(
    within(canvasElement).getByLabelText("Registered selections").textContent!
  ) as { name: string; fileName: string; bytes: number; type: string }[][]
}
function drop(input: HTMLElement, files: File[]) {
  const dataTransfer = new DataTransfer()
  for (const file of files) dataTransfer.items.add(file)
  input.parentElement!.dispatchEvent(
    new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer })
  )
}

export const MultipleFilesKeepOriginalBytesAndEditedNames: Story = {
  play: async ({ canvasElement }) => {
    const popup = await open(canvasElement)
    await userEvent.upload(popup.getByLabelText("Choose files"), [
      new File(["data"], "Original.txt", { type: "text/plain" }),
      new File([], "Empty.bin"),
    ])
    const names = popup.getAllByRole("textbox", { name: "Uploaded file name" })
    await userEvent.clear(names[0]!)
    await userEvent.type(names[0]!, "  中文 名称.txt  ")
    await userEvent.click(popup.getByRole("button", { name: "Start upload" }))
    await waitFor(() => expect(requests(canvasElement)).toHaveLength(1))
    await expect(requests(canvasElement)[0]).toEqual([
      {
        name: "中文 名称.txt",
        fileName: "Original.txt",
        bytes: 4,
        type: "text/plain",
      },
      { name: "Empty.bin", fileName: "Empty.bin", bytes: 0, type: "" },
    ])
    await expect(
      within(canvasElement).getByRole("button", { name: "Open selection" })
    ).toHaveFocus()
  },
}
export const NativeFileDropSupportsKeyboardSubmission: Story = {
  play: async ({ canvasElement }) => {
    const popup = await open(canvasElement)
    drop(popup.getByLabelText("Choose files"), [
      new File(["drag"], "Dropped.txt", { type: "text/plain" }),
    ])
    const name = await popup.findByRole("textbox", {
      name: "Uploaded file name",
    })
    name.focus()
    await userEvent.keyboard("{Enter}")
    await waitFor(() => expect(requests(canvasElement)).toHaveLength(1))
    await expect(requests(canvasElement)[0]![0]!.name).toBe("Dropped.txt")
  },
}
export const InvalidNameRetainsFileUntilCorrected: Story = {
  play: async ({ canvasElement }) => {
    const popup = await open(canvasElement)
    await userEvent.upload(
      popup.getByLabelText("Choose files"),
      new File(["file"], "Name.txt")
    )
    const name = popup.getByRole("textbox", { name: "Uploaded file name" })
    await userEvent.clear(name)
    await userEvent.type(name, "../private")
    await userEvent.click(popup.getByRole("button", { name: "Start upload" }))
    await expect(name).toHaveAttribute("aria-invalid", "true")
    await expect(name).toHaveValue("../private")
    await expect(requests(canvasElement)).toHaveLength(0)
    await userEvent.clear(name)
    await userEvent.type(name, "Valid.txt")
    await userEvent.click(popup.getByRole("button", { name: "Start upload" }))
    await waitFor(() => expect(requests(canvasElement)).toHaveLength(1))
  },
}
export const ActualOversizeFileCannotEnterQueue: Story = {
  play: async ({ canvasElement }) => {
    const popup = await open(canvasElement)
    await userEvent.upload(
      popup.getByLabelText("Choose files"),
      new File(
        [new Uint8Array(maxOrganizationUploadBytes + 1)],
        "Too large.bin"
      )
    )
    await userEvent.click(popup.getByRole("button", { name: "Start upload" }))
    await expect(
      await popup.findByText(
        "The file exceeds the size limit. Choose a smaller file.",
        { exact: true }
      )
    ).toBeVisible()
    await expect(requests(canvasElement)).toHaveLength(0)
    await expect(
      popup.getByRole("textbox", { name: "Uploaded file name" })
    ).toHaveValue("Too large.bin")
  },
}
export const RegistrationFailureRetainsSelection: Story = {
  args: { mode: "failure" },
  play: async ({ canvasElement }) => {
    const popup = await open(canvasElement)
    await userEvent.upload(
      popup.getByLabelText("Choose files"),
      new File(["keep"], "Kept.txt")
    )
    await userEvent.click(popup.getByRole("button", { name: "Start upload" }))
    await expect(await popup.findByRole("alert")).toHaveTextContent(
      "Files could not be added to the upload queue."
    )
    await expect(
      popup.getByRole("textbox", { name: "Uploaded file name" })
    ).toHaveValue("Kept.txt")
    await userEvent.click(popup.getByRole("button", { name: "Start upload" }))
    await waitFor(() => expect(requests(canvasElement)).toHaveLength(2))
  },
}
export const OverwriteRequiresExplicitConfirmationOfNamedTarget: Story = {
  args: { overwrite: true },
  play: async ({ canvasElement }) => {
    const popup = await open(canvasElement)
    await expect(
      popup.getByText(/Overwriting “Existing.txt” creates a new version/)
    ).toBeVisible()
    await userEvent.upload(
      popup.getByLabelText("Choose files"),
      new File(["new"], "Replacement.txt", { type: "text/plain" })
    )
    await expect(requests(canvasElement)).toHaveLength(0)
    await expect(
      popup.queryByRole("textbox", { name: "Uploaded file name" })
    ).not.toBeInTheDocument()
    await userEvent.click(
      popup.getByRole("button", { name: "Confirm overwrite" })
    )
    await waitFor(() => expect(requests(canvasElement)).toHaveLength(1))
    await expect(requests(canvasElement)[0]![0]).toEqual({
      name: "Existing.txt",
      fileName: "Replacement.txt",
      bytes: 3,
      type: "text/plain",
    })
  },
}
export const MultipleOverwriteDropDoesNotSilentlyChooseOne: Story = {
  args: { overwrite: true },
  play: async ({ canvasElement }) => {
    const popup = await open(canvasElement)
    drop(popup.getByLabelText("Choose files"), [
      new File(["a"], "A.txt"),
      new File(["b"], "B.txt"),
    ])
    await expect(await popup.findByRole("alert")).toHaveTextContent(
      "Choose exactly one file"
    )
    await expect(requests(canvasElement)).toHaveLength(0)
    await expect(
      popup.queryByText("A.txt", { exact: true })
    ).not.toBeInTheDocument()
  },
}
export const PendingRegistrationCannotCloseOrDuplicate: Story = {
  args: { mode: "pending" },
  play: async ({ canvasElement }) => {
    const popup = await open(canvasElement)
    await userEvent.upload(
      popup.getByLabelText("Choose files"),
      new File(["a"], "Pending.txt")
    )
    await userEvent.click(popup.getByRole("button", { name: "Start upload" }))
    await expect(popup.getByLabelText("Choose files")).toBeDisabled()
    await expect(popup.getByRole("button", { name: "Cancel" })).toBeDisabled()
    await userEvent.keyboard("{Escape}{Enter}")
    await expect(requests(canvasElement)).toHaveLength(1)
    await expect(
      within(canvasElement.ownerDocument.body).getByRole("dialog")
    ).toBeVisible()
  },
}
export const ScopeChangeCancelsLateRegistration: Story = {
  args: { mode: "scopeChange" },
  play: async ({ canvasElement }) => {
    const popup = await open(canvasElement)
    await userEvent.upload(
      popup.getByLabelText("Choose files"),
      new File(["a"], "Private.txt")
    )
    await userEvent.click(popup.getByRole("button", { name: "Start upload" }))
    await waitFor(() =>
      expect(
        within(canvasElement).getByLabelText("Registration canceled")
      ).toHaveTextContent("true")
    )
    await waitFor(() =>
      expect(
        within(canvasElement.ownerDocument.body).getByRole("dialog")
      ).toBeVisible()
    )
    await expect(
      within(canvasElement.ownerDocument.body).queryByText("Private.txt", {
        exact: true,
      })
    ).not.toBeInTheDocument()
  },
}
export const PermissionDeniedKeepsWriteDisabled: Story = {
  args: { canSubmit: false },
  play: async ({ canvasElement }) => {
    const popup = await open(canvasElement)
    await expect(popup.getByLabelText("Choose files")).toBeDisabled()
    await expect(
      popup.getByRole("button", { name: "Start upload" })
    ).toBeDisabled()
    await expect(requests(canvasElement)).toHaveLength(0)
  },
}
export const ArabicSelectionKeepsRtlAndOriginalFile: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    const popup = await open(canvasElement)
    await expect(canvasElement.ownerDocument.documentElement).toHaveAttribute(
      "dir",
      "rtl"
    )
    await userEvent.upload(
      popup.getByLabelText("اختيار ملفات"),
      new File(["Arabic"], "ملف عربي.txt", { type: "text/plain" })
    )
    await userEvent.click(popup.getByRole("button", { name: "بدء الرفع" }))
    await waitFor(() => expect(requests(canvasElement)).toHaveLength(1))
    await expect(requests(canvasElement)[0]![0]!.fileName).toBe("ملف عربي.txt")
  },
}
