import { useRef, useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { ApiClientError } from "@workspace/api-client"
import {
  CreateFolderSchema,
  FileOperationResponseSchema,
  FolderResponseSchema,
  type CreateFolder,
  type FileOperationResponse,
} from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import { CreateFolderDialog } from "./create-folder-dialog"

const id = (value: number) =>
  `28b09a98-1cfa-4b40-8c1a-${String(value).padStart(12, "0")}`
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
const operation = (
  operationId: string,
  phase: "completed" | "committed" | "failed"
): FileOperationResponse =>
  FileOperationResponseSchema.parse({
    id: operationId,
    action: "create-folder",
    phase,
    committedAt: phase === "failed" ? null : "2026-10-01T00:00:00.000Z",
    completedAt: phase === "completed" ? "2026-10-01T00:00:00.000Z" : null,
    errorCode: phase === "failed" ? "FILE_NAME_CONFLICT" : null,
    result: phase === "failed" ? null : { entryId: id(4), revision: 1 },
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  })

function CreationFixture({
  mode = "complete",
  canCreate = true,
}: {
  mode?:
    | "complete"
    | "rejected"
    | "pending"
    | "failed"
    | "uncertainComplete"
    | "uncertainUnreadable"
    | "committed"
    | "scopeChange"
  canCreate?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState("user:organization:1")
  const [calls, setCalls] = useState<CreateFolder[]>([])
  const [reads, setReads] = useState<string[]>([])
  const [completed, setCompleted] = useState<string>()
  const [aborted, setAborted] = useState(false)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const create = async (input: CreateFolder, signal: AbortSignal) => {
    CreateFolderSchema.parse(input)
    setCalls((current) => [...current, input])
    if (mode === "pending" || mode === "scopeChange") {
      const finished = new Promise<void>((resolve) =>
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
      await finished
    }
    if (mode === "rejected" && calls.length === 0)
      throw new ApiClientError(409, {
        code: "FILE_NAME_CONFLICT",
        requestId: crypto.randomUUID(),
        locale: "en-US",
        message: "This folder already has that name.",
      })
    if (mode === "uncertainComplete" || mode === "uncertainUnreadable")
      throw new TypeError("Response unavailable")
    return operation(
      input.operationId,
      mode === "failed" && calls.length === 0
        ? "failed"
        : mode === "committed"
          ? "committed"
          : "completed"
    )
  }
  const read = async (operationId: string) => {
    setReads((current) => [...current, operationId])
    if (mode === "uncertainUnreadable")
      throw new ApiClientError(503, {
        code: "FILE_STORAGE_UNAVAILABLE",
        requestId: crypto.randomUUID(),
        locale: "en-US",
        message: "The operation status is unavailable.",
      })
    return operation(operationId, "completed")
  }
  // 此处固定英文驱动和正式 DTO 夹具只用于组件证据；不代替产品 API 验收。
  // i18next-instrument-ignore
  return (
    <div className="p-6">
      <Button ref={trigger} onClick={() => setOpen(true)}>
        Open creation
      </Button>
      <output aria-label="Create requests">{JSON.stringify(calls)}</output>
      <output aria-label="Status reads">{JSON.stringify(reads)}</output>
      <output aria-label="Completed identity">{completed}</output>
      <output aria-label="Aborted request">{String(aborted)}</output>
      <CreateFolderDialog
        open={open}
        parent={parent}
        contentScopeKey={scope}
        authorizationVersion={1}
        canCreate={canCreate}
        createFolder={create}
        readOperation={read}
        onClose={() => setOpen(false)}
        onCompleted={(value) => setCompleted(value.id)}
        returnFocus={() => trigger.current}
      />
    </div>
  )
}

const meta = {
  title: "Tenant/Create folder",
  component: CreationFixture,
  globals: { locale: "en-US" },
} satisfies Meta<typeof CreationFixture>
export default meta
type Story = StoryObj<typeof meta>

async function open(canvasElement: HTMLElement) {
  await userEvent.click(
    within(canvasElement).getByRole("button", { name: "Open creation" })
  )
  return within(
    await within(canvasElement.ownerDocument.body).findByRole("dialog")
  )
}
function requests(canvasElement: HTMLElement): CreateFolder[] {
  return JSON.parse(
    within(canvasElement).getByLabelText("Create requests").textContent!
  )
}

export const CreatesInsideExplicitParent: Story = {
  play: async ({ canvasElement }) => {
    const popup = await open(canvasElement)
    await expect(popup.getByText(/inside “Manuals”/)).toBeVisible()
    await userEvent.type(
      popup.getByRole("textbox", { name: "Folder name" }),
      "  中文目录  "
    )
    await userEvent.click(popup.getByRole("button", { name: "Create folder" }))
    await waitFor(() =>
      expect(
        within(canvasElement.ownerDocument.body).queryByRole("dialog")
      ).not.toBeInTheDocument()
    )
    const [input] = requests(canvasElement)
    await expect(input!.parentId).toBe(parent.id)
    await expect(input!.name).toBe("中文目录")
    await expect(CreateFolderSchema.safeParse(input).success).toBe(true)
    await expect(
      within(canvasElement).getByRole("button", { name: "Open creation" })
    ).toHaveFocus()
  },
}
export const InvalidNameKeepsInput: Story = {
  play: async ({ canvasElement }) => {
    const popup = await open(canvasElement)
    const input = popup.getByRole("textbox", { name: "Folder name" })
    await userEvent.type(input, "../private")
    await userEvent.click(popup.getByRole("button", { name: "Create folder" }))
    await expect(input).toHaveAttribute("aria-invalid", "true")
    await expect(input).toHaveValue("../private")
    await expect(requests(canvasElement)).toEqual([])
    await userEvent.clear(input)
    await userEvent.type(input, "Safe name")
    await userEvent.click(popup.getByRole("button", { name: "Create folder" }))
    await waitFor(() => expect(requests(canvasElement)).toHaveLength(1))
  },
}
export const ChineseByteBoundary: Story = {
  globals: { locale: "zh-CN" },
  play: async ({ canvasElement }) => {
    const popup = await open(canvasElement)
    const input = popup.getByRole("textbox", { name: "文件夹名称" })
    await userEvent.type(input, "你".repeat(83))
    await userEvent.click(popup.getByRole("button", { name: "创建文件夹" }))
    await expect(
      popup.getByText("文件夹名称过长，请缩短名称。", { exact: true })
    ).toBeVisible()
    await expect(requests(canvasElement)).toHaveLength(0)
    await userEvent.clear(input)
    await userEvent.type(input, "你".repeat(82))
    await userEvent.click(popup.getByRole("button", { name: "创建文件夹" }))
    await waitFor(() => expect(requests(canvasElement)).toHaveLength(1))
    await expect(
      new TextEncoder().encode(requests(canvasElement)[0]!.name).byteLength
    ).toBe(246)
  },
}
export const RejectionRetainsDraftThenExplicitNewIdentity: Story = {
  args: { mode: "rejected" },
  play: async ({ canvasElement }) => {
    const popup = await open(canvasElement)
    const input = popup.getByRole("textbox", { name: "Folder name" })
    await userEvent.type(input, "Duplicate")
    await userEvent.click(popup.getByRole("button", { name: "Create folder" }))
    await expect(await popup.findByRole("alert")).toHaveTextContent(
      "This folder already has that name."
    )
    await expect(input).toHaveValue("Duplicate")
    const first = requests(canvasElement)[0]!
    await userEvent.clear(input)
    await userEvent.type(input, "Changed name")
    await expect(requests(canvasElement)).toHaveLength(1)
    await userEvent.click(popup.getByRole("button", { name: "Create again" }))
    await waitFor(() => expect(requests(canvasElement)).toHaveLength(2))
    await expect(requests(canvasElement)[1]!.operationId).not.toBe(
      first.operationId
    )
    await expect(requests(canvasElement)[1]!.name).toBe("Changed name")
  },
}
export const FailedOperationAllowsExplicitNewIdentity: Story = {
  args: { mode: "failed" },
  play: async ({ canvasElement }) => {
    const popup = await open(canvasElement)
    await userEvent.type(
      popup.getByRole("textbox", { name: "Folder name" }),
      "Duplicate"
    )
    await userEvent.click(popup.getByRole("button", { name: "Create folder" }))
    await expect(await popup.findByRole("alert")).toHaveTextContent(
      "A file or folder with this name already exists here. Choose another name."
    )
    await expect(
      popup.getByRole("textbox", { name: "Folder name" })
    ).toHaveValue("Duplicate")
    await userEvent.click(popup.getByRole("button", { name: "Create again" }))
    await waitFor(() => expect(requests(canvasElement)).toHaveLength(2))
    await expect(requests(canvasElement)[1]!.operationId).not.toBe(
      requests(canvasElement)[0]!.operationId
    )
  },
}
export const PendingLocksKeyboardAndDuplicateSubmission: Story = {
  args: { mode: "pending" },
  play: async ({ canvasElement }) => {
    const popup = await open(canvasElement)
    await userEvent.type(
      popup.getByRole("textbox", { name: "Folder name" }),
      "Pending"
    )
    await userEvent.click(popup.getByRole("button", { name: "Create folder" }))
    await expect(
      popup.getByRole("textbox", { name: "Folder name" })
    ).toBeDisabled()
    await expect(popup.getByRole("button", { name: "Cancel" })).toBeDisabled()
    await userEvent.keyboard("{Escape}{Enter}")
    await expect(
      within(canvasElement.ownerDocument.body).getByRole("dialog")
    ).toBeVisible()
    await expect(requests(canvasElement)).toHaveLength(1)
  },
}
export const UncertainResponseReadsOriginalIdentity: Story = {
  args: { mode: "uncertainComplete" },
  play: async ({ canvasElement }) => {
    const popup = await open(canvasElement)
    await userEvent.type(
      popup.getByRole("textbox", { name: "Folder name" }),
      "Confirmed"
    )
    await userEvent.click(popup.getByRole("button", { name: "Create folder" }))
    await waitFor(() =>
      expect(
        within(canvasElement).getByLabelText("Completed identity")
      ).not.toBeEmptyDOMElement()
    )
    await expect(requests(canvasElement)).toHaveLength(1)
    await expect(
      JSON.parse(
        within(canvasElement).getByLabelText("Status reads").textContent!
      )
    ).toEqual([requests(canvasElement)[0]!.operationId])
  },
}
export const UnreadableStatusKeepsDraftAndStopsWrites: Story = {
  args: { mode: "uncertainUnreadable" },
  play: async ({ canvasElement }) => {
    const popup = await open(canvasElement)
    await userEvent.type(
      popup.getByRole("textbox", { name: "Folder name" }),
      "Unconfirmed"
    )
    await userEvent.click(popup.getByRole("button", { name: "Create folder" }))
    await expect(
      await popup.findByText("The operation status is unavailable.", {
        exact: true,
      })
    ).toBeVisible()
    await expect(
      popup.getByRole("textbox", { name: "Folder name" })
    ).toHaveValue("Unconfirmed")
    await expect(
      popup.getByRole("textbox", { name: "Folder name" })
    ).toBeDisabled()
    await userEvent.click(popup.getByRole("button", { name: "Check status" }))
    await waitFor(() =>
      expect(
        JSON.parse(
          within(canvasElement).getByLabelText("Status reads").textContent!
        )
      ).toHaveLength(2)
    )
    await expect(requests(canvasElement)).toHaveLength(1)
  },
}
export const CommittedWaitsForCompletion: Story = {
  args: { mode: "committed" },
  play: UncertainResponseReadsOriginalIdentity.play,
}
export const PermissionDenied: Story = {
  args: { canCreate: false },
  play: async ({ canvasElement }) => {
    const popup = await open(canvasElement)
    await expect(
      popup.getByRole("textbox", { name: "Folder name" })
    ).toBeDisabled()
    await expect(
      popup.getByRole("button", { name: "Create folder" })
    ).toBeDisabled()
    await expect(popup.getByRole("alert")).toHaveTextContent(
      "You do not have permission to perform this action."
    )
    await expect(requests(canvasElement)).toHaveLength(0)
  },
}
export const AuthorizationScopeCancelsLateCompletion: Story = {
  args: { mode: "scopeChange" },
  play: async ({ canvasElement }) => {
    const popup = await open(canvasElement)
    await userEvent.type(
      popup.getByRole("textbox", { name: "Folder name" }),
      "Old draft"
    )
    await userEvent.click(popup.getByRole("button", { name: "Create folder" }))
    await waitFor(() =>
      expect(
        within(canvasElement).getByLabelText("Aborted request")
      ).toHaveTextContent("true")
    )
    await expect(
      within(canvasElement).getByLabelText("Completed identity")
    ).toBeEmptyDOMElement()
    const current = within(
      within(canvasElement.ownerDocument.body).getByRole("dialog")
    )
    await expect(
      current.getByRole("textbox", { name: "Folder name" })
    ).toHaveValue("")
  },
}
export const ArabicKeyboardCreation: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    const popup = await open(canvasElement)
    await expect(canvasElement.ownerDocument.documentElement).toHaveAttribute(
      "dir",
      "rtl"
    )
    const input = popup.getByRole("textbox", { name: "اسم المجلد" })
    await userEvent.type(input, "مجلد جديد")
    input.focus()
    await userEvent.keyboard("{Enter}")
    await waitFor(() => expect(requests(canvasElement)).toHaveLength(1))
  },
}
