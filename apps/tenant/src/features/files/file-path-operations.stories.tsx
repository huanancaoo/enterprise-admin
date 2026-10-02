import { StrictMode, useRef, useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { ApiClientError } from "@workspace/api-client"
import {
  FileEntryImpactSchema,
  FileOperationResponseSchema,
  FileResponseSchema,
  FolderResponseSchema,
  type FileEntryResponse,
  type FileOperationResponse,
} from "@workspace/contracts"
import {
  createFilePickerScenario,
  filePickerRoot,
  filePickerFolder,
} from "@workspace/mocks"
import { Button } from "@workspace/ui/components/button"
import { FileEntryDialog } from "./file-entry-dialog"
import { FileDeleteDialog } from "./file-delete-dialog"
import { FilePathQueue } from "./file-path-queue"
import {
  filePathRecordKey,
  useFilePathOperations,
  type FilePathAction,
  type FilePathBody,
  type FilePathCommand,
} from "./use-file-path-operations"

const id = (index: number) =>
  `2ab09a98-1cfa-4b40-8c1a-${String(index).padStart(12, "0")}`
const at = "2026-10-01T00:00:00.000Z"
const folder = FolderResponseSchema.parse({
  ...filePickerFolder,
  id: id(1),
  name: "Manuals",
  path: ["Manuals"],
})
const file = FileResponseSchema.parse({
  ...folder,
  kind: "file",
  id: id(2),
  parentId: filePickerRoot.id,
  name: "Report.txt",
  path: ["Report.txt"],
  currentVersion: {
    id: id(3),
    fileId: id(2),
    bytes: 3,
    contentType: "text/plain",
    sha256: "0".repeat(64),
    previewKind: "text",
    isCurrent: true,
    createdAt: at,
    retiredAt: null,
    expiresAt: null,
  },
})
function receipt(
  operationId: string,
  phase: FileOperationResponse["phase"] = "completed"
) {
  return FileOperationResponseSchema.parse({
    id: operationId,
    action: "rename",
    phase,
    committedAt: phase === "failed" ? null : at,
    completedAt: phase === "completed" ? at : null,
    errorCode: phase === "failed" ? "FILE_NAME_CONFLICT" : null,
    result: phase === "failed" ? null : { entryId: folder.id, revision: 2 },
    createdAt: at,
    updatedAt: at,
  })
}
const apiError = (
  status: number,
  code: "FILE_NAME_CONFLICT" | "FORBIDDEN" | "FILE_STORAGE_UNAVAILABLE",
  message: string
) =>
  new ApiClientError(status, {
    code,
    message,
    requestId: id(9),
    locale: "en-US",
  })
type Mode =
  | "success"
  | "network"
  | "serverUnknown"
  | "rejected"
  | "pending"
  | "cleaning"
  | "readDenied"
  | "storageUnavailable"
  | "restored"
type Post = { action: FilePathAction; entryId: string; body: FilePathBody }

function Execution({
  userId,
  organizationId,
  mode,
  posts,
  reads,
  saved,
  completed,
  aborted,
}: {
  userId: string
  organizationId: string
  mode: Mode
  posts: (value: Post) => void
  reads: (value: string) => void
  saved: (value: string | null) => void
  completed: () => void
  aborted: () => void
}) {
  const submitted = useRef(0)
  const cleanupFinished = useRef(false)
  const submittedAt = useRef<number | undefined>(undefined)
  const [firstReadDelay, setFirstReadDelay] = useState<number>()
  const [error, setError] = useState("")
  const [storage] = useState<Storage>(() =>
    mode === "storageUnavailable"
      ? {
          length: 0,
          clear: () => undefined,
          key: () => null,
          getItem: (key) => sessionStorage.getItem(key),
          removeItem: () => undefined,
          setItem: () => {
            throw new DOMException("Storage unavailable", "QuotaExceededError")
          },
        }
      : sessionStorage
  )
  const operations = useFilePathOperations({
    userId,
    organizationId,
    storage,
    canPerform: () => true,
    submit: async (action, entryId, body, signal) => {
      submittedAt.current = performance.now()
      const first = submitted.current++ === 0
      saved(storage.getItem(filePathRecordKey(userId, organizationId)))
      posts({ action, entryId, body })
      if (mode === "network" || mode === "readDenied")
        throw new TypeError("Lost response")
      if (mode === "serverUnknown")
        throw apiError(
          503,
          "FILE_STORAGE_UNAVAILABLE",
          "Unconfirmed server result"
        )
      if (mode === "rejected" && first)
        throw apiError(409, "FILE_NAME_CONFLICT", "Name already exists")
      if (mode === "pending") {
        await new Promise<void>((resolve) =>
          signal.addEventListener(
            "abort",
            () => {
              aborted()
              resolve()
            },
            { once: true }
          )
        )
      }
      return receipt(
        body.operationId,
        mode === "cleaning" ? "cleaning" : "completed"
      )
    },
    readOperation: async (operationId, signal) => {
      if (submittedAt.current !== undefined) {
        const delay = performance.now() - submittedAt.current
        setFirstReadDelay((previous) => previous ?? delay)
      }
      reads(operationId)
      if (mode === "readDenied")
        throw apiError(403, "FORBIDDEN", "Status permission removed")
      // 异步读使 StrictMode 的取消与第二次查询实际交错，而不是同步假收据。
      await Promise.resolve()
      if (signal.aborted) throw new DOMException("Aborted", "AbortError")
      return receipt(
        operationId,
        mode === "cleaning" && !cleanupFinished.current
          ? "cleaning"
          : "completed"
      )
    },
    onCompleted: completed,
  })
  const start = async () => {
    setError("")
    try {
      await operations.execute({
        action: "rename",
        entry: folder,
        name: "Renamed",
      })
    } catch (cause) {
      setError((cause as Error).message)
    }
  }
  // i18next-instrument-ignore
  return (
    <div className="space-y-4">
      <output aria-label="First status read delay">{firstReadDelay}</output>
      <Button onClick={() => void start()}>Submit rename</Button>
      <Button
        onClick={() => {
          cleanupFinished.current = true
        }}
      >
        Finish cleanup
      </Button>
      {error && <p role="alert">{error}</p>}
      <FilePathQueue
        jobs={operations.jobs}
        recordError={operations.recordError}
        onCheck={(value) => void operations.check(value)}
        onDismiss={operations.dismiss}
      />
    </div>
  )
}
function PathFixture({ mode = "success" }: { mode?: Mode }) {
  const [userId] = useState(() => crypto.randomUUID())
  const [organizationId, setOrganizationId] = useState(
    filePickerRoot.organizationId
  )
  const [instance, setInstance] = useState(0)
  const [posts, setPosts] = useState<Post[]>([])
  const [reads, setReads] = useState<string[]>([])
  const [saved, setSaved] = useState<string | null>(null)
  const [completed, setCompleted] = useState(0)
  const [aborted, setAborted] = useState(false)
  const [seed] = useState(() => {
    if (mode === "restored")
      sessionStorage.setItem(
        filePathRecordKey(userId, organizationId),
        JSON.stringify([
          {
            id: id(8),
            action: "rename",
            phase: "unconfirmed",
            createdAt: at,
            updatedAt: at,
          },
        ])
      )
    return id(8)
  })
  // 固定英文驱动与收据只验证组件协议；正式产品验收另走真实 API 与存储。
  // i18next-instrument-ignore
  return (
    <main className="space-y-4 p-6">
      <Button onClick={() => setInstance((value) => value + 1)}>
        Refresh component
      </Button>
      <Button onClick={() => setOrganizationId(id(99))}>
        Change organization
      </Button>
      <output aria-label="Posts">{JSON.stringify(posts)}</output>
      <output aria-label="Reads">{JSON.stringify(reads)}</output>
      <output aria-label="Saved before POST">{saved}</output>
      <output aria-label="Completed">{completed}</output>
      <output aria-label="Aborted">{String(aborted)}</output>
      <output aria-label="Seed">{seed}</output>
      <StrictMode>
        <Execution
          key={`${organizationId}:${instance}`}
          userId={userId}
          organizationId={organizationId}
          mode={mode}
          posts={(value) => setPosts((current) => [...current, value])}
          reads={(value) => setReads((current) => [...current, value])}
          saved={setSaved}
          completed={() => setCompleted((current) => current + 1)}
          aborted={() => setAborted(true)}
        />
      </StrictMode>
    </main>
  )
}
const meta = {
  title: "Tenant/File path operations",
  component: PathFixture,
  globals: { locale: "en-US" },
} satisfies Meta<typeof PathFixture>
export default meta
type Story = StoryObj<typeof meta>
const values = <T,>(canvas: HTMLElement, label: string): T =>
  JSON.parse(within(canvas).getByLabelText(label).textContent!)
async function start(canvas: HTMLElement) {
  await userEvent.click(
    within(canvas).getByRole("button", { name: "Submit rename" })
  )
}
export const SavesOnlyIdentityBeforeSending: Story = {
  play: async ({ canvasElement }) => {
    await start(canvasElement)
    await waitFor(() =>
      expect(
        within(canvasElement).getByText("Completed", { exact: true })
      ).toBeVisible()
    )
    const [post] = values<Post[]>(canvasElement, "Posts")
    const [saved] = values<Record<string, string>[]>(
      canvasElement,
      "Saved before POST"
    )
    await expect(Object.keys(saved!).sort()).toEqual([
      "action",
      "createdAt",
      "id",
      "phase",
      "updatedAt",
    ])
    await expect(saved!.id).toBe(post!.body.operationId)
    await expect(saved!.phase).toBe("unconfirmed")
    await expect(
      within(canvasElement).getByLabelText("Completed")
    ).toHaveTextContent("1")
  },
}
async function confirmsOriginal(canvasElement: HTMLElement) {
  await start(canvasElement)
  await waitFor(
    () =>
      expect(values<string[]>(canvasElement, "Reads").length).toBeGreaterThan(
        0
      ),
    { timeout: 4000 }
  )
  const [post] = values<Post[]>(canvasElement, "Posts")
  await expect(
    values<string[]>(canvasElement, "Reads").every(
      (value) => value === post!.body.operationId
    )
  ).toBe(true)
  await expect(values<Post[]>(canvasElement, "Posts")).toHaveLength(1)
  await waitFor(() =>
    expect(
      within(canvasElement).getByText("Completed", { exact: true })
    ).toBeVisible()
  )
}
export const NetworkLossQueriesOriginal: Story = {
  args: { mode: "network" },
  play: ({ canvasElement }) => confirmsOriginal(canvasElement),
}
export const ServerFailureQueriesOriginal: Story = {
  args: { mode: "serverUnknown" },
  play: async ({ canvasElement }) => {
    await confirmsOriginal(canvasElement)
    // 真实首次 GET 在等待窗口之后开始，避免未知提交尚未可读时过早读到404。
    await expect(
      Number(
        within(canvasElement).getByLabelText("First status read delay")
          .textContent
      )
    ).toBeGreaterThanOrEqual(1400)
  },
}
export const RefreshAndStrictModeNeverReplayPost: Story = {
  args: { mode: "restored" },
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(
        within(canvasElement).getByText("Completed", { exact: true })
      ).toBeVisible()
    )
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Refresh component" })
    )
    await waitFor(() =>
      expect(
        within(canvasElement).getByText("Completed", { exact: true })
      ).toBeVisible()
    )
    await expect(values<Post[]>(canvasElement, "Posts")).toEqual([])
    await expect(
      values<string[]>(canvasElement, "Reads").every((value) => value === id(8))
    ).toBe(true)
    await expect(
      within(canvasElement).getByLabelText("Completed")
    ).toHaveTextContent("1")
    await expect(
      within(canvasElement).queryByText("Manuals", { exact: true })
    ).toBeNull()
  },
}
export const ScopeChangeAbortsOldWrite: Story = {
  args: { mode: "pending" },
  play: async ({ canvasElement }) => {
    await start(canvasElement)
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Change organization" })
    )
    await waitFor(() =>
      expect(within(canvasElement).getByLabelText("Aborted")).toHaveTextContent(
        "true"
      )
    )
    await expect(
      within(canvasElement).getByLabelText("Completed")
    ).toHaveTextContent("0")
    await expect(
      within(canvasElement).queryByText("Manuals", { exact: true })
    ).toBeNull()
  },
}
export const StorageFailurePreventsPost: Story = {
  args: { mode: "storageUnavailable" },
  play: async ({ canvasElement }) => {
    await start(canvasElement)
    await expect(values<Post[]>(canvasElement, "Posts")).toEqual([])
    await expect(
      within(canvasElement).getAllByRole("alert")[0]
    ).toHaveTextContent(/operation identity could not be saved/i)
  },
}
export const KnownConflictRequiresNewExplicitSubmission: Story = {
  args: { mode: "rejected" },
  play: async ({ canvasElement }) => {
    await start(canvasElement)
    await waitFor(() =>
      expect(
        within(canvasElement).getByText("Not completed", { exact: true })
      ).toBeVisible()
    )
    await expect(values<string[]>(canvasElement, "Reads")).toEqual([])
    await start(canvasElement)
    const posts = values<Post[]>(canvasElement, "Posts")
    await expect(posts).toHaveLength(2)
    await expect(posts[0]!.body.operationId).not.toBe(
      posts[1]!.body.operationId
    )
  },
}
export const SavedCleanupRemainsQueryable: Story = {
  args: { mode: "cleaning" },
  play: async ({ canvasElement }) => {
    await start(canvasElement)
    await expect(
      within(canvasElement).getByText("Saved; cleanup is in progress")
    ).toBeVisible()
    await expect(
      within(canvasElement).getByLabelText("Completed")
    ).toHaveTextContent("0")
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Finish cleanup" })
    )
    await userEvent.click(
      within(canvasElement).getByRole("button", {
        name: "Check status",
      })
    )
    await waitFor(() =>
      expect(
        within(canvasElement).getByText("Completed", { exact: true })
      ).toBeVisible()
    )
    await expect(values<Post[]>(canvasElement, "Posts")).toHaveLength(1)
  },
}
export const DeniedReadStopsAutomaticQueries: Story = {
  args: { mode: "readDenied" },
  play: async ({ canvasElement }) => {
    await start(canvasElement)
    await waitFor(
      () =>
        expect(
          within(canvasElement).getByText("Status permission removed")
        ).toBeVisible(),
      { timeout: 4000 }
    )
    const count = values<string[]>(canvasElement, "Reads").length
    await new Promise((resolve) => setTimeout(resolve, 1700))
    await expect(values<string[]>(canvasElement, "Reads")).toHaveLength(count)
    await expect(values<Post[]>(canvasElement, "Posts")).toHaveLength(1)
    await expect(
      within(canvasElement).getByLabelText("Completed")
    ).toHaveTextContent("0")
  },
}

function NameFixture({
  action = "rename",
  kind = "folder",
  rejected = false,
}: {
  action?: "rename" | "move" | "restore"
  kind?: "file" | "folder"
  rejected?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [calls, setCalls] = useState<FilePathCommand[]>([])
  const trigger = useRef<HTMLButtonElement | null>(null)
  const source: FileEntryResponse = {
    ...(kind === "folder" ? folder : file),
    ...(action === "restore"
      ? {
          state: "trashed",
          deletedAt: at,
          expiresAt: "2026-11-01T00:00:00.000Z",
        }
      : {}),
  }
  // i18next-instrument-ignore
  return (
    <main className="space-y-4 p-6">
      <Button ref={trigger} onClick={() => setOpen(true)}>
        Open form
      </Button>
      <output aria-label="Commands">{JSON.stringify(calls)}</output>
      <FileEntryDialog
        action={action}
        entry={source}
        root={filePickerRoot}
        authorizationVersion={1}
        contentScopeKey="story-name-scope"
        open={open}
        canSubmit
        execute={async (command) => {
          setCalls((current) => [...current, command])
          if (rejected && calls.length === 0)
            throw new Error("The revision changed; refresh the entry.")
        }}
        readEntry={async () => ({ ...source, revision: 5 })}
        onClose={() => setOpen(false)}
        returnFocus={() => trigger.current}
      />
    </main>
  )
}
async function openForm(canvas: HTMLElement) {
  await userEvent.click(
    within(canvas).getByRole("button", { name: "Open form" })
  )
  const dialog = await within(document.body).findByRole("dialog")
  await waitFor(() => expect(dialog).toBeVisible())
  return within(dialog)
}
export const UnchangedAndInvalidNamesDoNotSubmit: Story = {
  render: () => <NameFixture />,
  play: async ({ canvasElement }) => {
    const popup = await openForm(canvasElement)
    await userEvent.click(popup.getByRole("button", { name: "Rename" }))
    await expect(popup.getByText("Enter a different new name.")).toBeVisible()
    const name = popup.getByRole("textbox", { name: "Name" })
    await userEvent.clear(name)
    await userEvent.type(name, "../escape")
    await userEvent.click(popup.getByRole("button", { name: "Rename" }))
    await expect(name).toHaveAttribute("aria-invalid", "true")
    await expect(values<FilePathCommand[]>(canvasElement, "Commands")).toEqual(
      []
    )
  },
}
export const ConflictRefreshKeepsDraftAndUpdatesRevision: Story = {
  render: () => <NameFixture rejected />,
  play: async ({ canvasElement }) => {
    const popup = await openForm(canvasElement)
    const name = popup.getByRole("textbox", { name: "Name" })
    await userEvent.clear(name)
    await userEvent.type(name, "  e\u0301quipe  ")
    await userEvent.click(popup.getByRole("button", { name: "Rename" }))
    await expect(popup.getByRole("alert")).toHaveTextContent(/revision changed/)
    await expect(name).toHaveValue("  e\u0301quipe  ")
    await userEvent.click(popup.getByRole("button", { name: "Refresh entry" }))
    await waitFor(() =>
      expect(popup.getByRole("button", { name: "Rename" })).toBeEnabled()
    )
    await userEvent.click(popup.getByRole("button", { name: "Rename" }))
    await waitFor(() =>
      expect(values<FilePathCommand[]>(canvasElement, "Commands")).toHaveLength(
        2
      )
    )
    const commands = values<FilePathCommand[]>(canvasElement, "Commands")
    await expect(commands[1]).toMatchObject({
      action: "rename",
      name: "équipe",
      entry: { revision: 5 },
    })
    await waitFor(() =>
      expect(
        within(canvasElement).getByRole("button", { name: "Open form" })
      ).toHaveFocus()
    )
  },
}
export const FolderByteLimitIs246: Story = {
  globals: { locale: "zh-CN" },
  render: () => <NameFixture />,
  play: async ({ canvasElement }) => {
    const popup = await openForm(canvasElement)
    const name = popup.getByRole("textbox", { name: "名称" })
    await userEvent.clear(name)
    await userEvent.type(name, "你".repeat(83))
    await userEvent.click(popup.getByRole("button", { name: "重命名" }))
    await expect(name).toHaveAttribute("aria-invalid", "true")
    await expect(values<FilePathCommand[]>(canvasElement, "Commands")).toEqual(
      []
    )
    await userEvent.clear(name)
    await userEvent.type(name, "你".repeat(82))
    await userEvent.click(popup.getByRole("button", { name: "重命名" }))
    await waitFor(() =>
      expect(values<FilePathCommand[]>(canvasElement, "Commands")).toHaveLength(
        1
      )
    )
  },
}
export const FileByteLimitIs255: Story = {
  render: () => <NameFixture kind="file" />,
  play: async ({ canvasElement }) => {
    const popup = await openForm(canvasElement)
    const name = popup.getByRole("textbox", { name: "Name" })
    await userEvent.clear(name)
    await userEvent.type(name, "你".repeat(85) + "a")
    await userEvent.click(popup.getByRole("button", { name: "Rename" }))
    await expect(name).toHaveAttribute("aria-invalid", "true")
    await userEvent.clear(name)
    await userEvent.type(name, "你".repeat(85))
    await userEvent.click(popup.getByRole("button", { name: "Rename" }))
    await waitFor(() =>
      expect(values<FilePathCommand[]>(canvasElement, "Commands")).toHaveLength(
        1
      )
    )
  },
}
const picker = createFilePickerScenario("success")
export const RestoreChoosesActualActiveFolder: Story = {
  beforeEach: picker.reset,
  parameters: { msw: { handlers: picker.handlers } },
  render: () => <NameFixture action="restore" />,
  play: async ({ canvasElement }) => {
    const popup = await openForm(canvasElement)
    await expect(popup.getByText("Original folder")).toBeVisible()
    await userEvent.click(
      popup.getByRole("button", { name: "Restore location" })
    )
    const pick = within(
      await within(document.body).findByRole("dialog", {
        name: "Choose destination folder",
      })
    )
    await userEvent.click(await pick.findByRole("button", { name: "Manuals" }))
    await waitFor(() =>
      expect(
        pick.getByRole("button", { name: "Use this folder" })
      ).toBeEnabled()
    )
    await userEvent.click(pick.getByRole("button", { name: "Use this folder" }))
    await waitFor(() =>
      expect(popup.getByText("Destination: Manuals")).toBeVisible()
    )
    await userEvent.click(popup.getByRole("button", { name: "Restore" }))
    await waitFor(() =>
      expect(values<FilePathCommand[]>(canvasElement, "Commands")).toHaveLength(
        1
      )
    )
    await expect(
      values<FilePathCommand[]>(canvasElement, "Commands")[0]
    ).toMatchObject({
      action: "restore",
      parentId: filePickerFolder.id,
      name: folder.name,
    })
  },
}
export const MoveRequiresExplicitDestinationAndConfirmation: Story = {
  beforeEach: picker.reset,
  parameters: { msw: { handlers: picker.handlers } },
  render: () => <NameFixture action="move" kind="file" />,
  play: async ({ canvasElement }) => {
    const popup = await openForm(canvasElement)
    await expect(popup.queryByRole("textbox")).toBeNull()
    await userEvent.click(popup.getByRole("button", { name: "Move" }))
    await expect(values<FilePathCommand[]>(canvasElement, "Commands")).toEqual(
      []
    )
    await userEvent.click(
      popup.getByRole("button", { name: "Destination folder" })
    )
    const pick = within(
      await within(document.body).findByRole("dialog", {
        name: "Choose destination folder",
      })
    )
    await expect(
      pick.getByRole("button", { name: "Use this folder" })
    ).toBeDisabled()
    await userEvent.click(await pick.findByRole("button", { name: "Manuals" }))
    await waitFor(() =>
      expect(
        pick.getByRole("button", { name: "Use this folder" })
      ).toBeEnabled()
    )
    await userEvent.click(pick.getByRole("button", { name: "Use this folder" }))
    await waitFor(() =>
      expect(popup.getByText("Destination: Manuals")).toBeVisible()
    )
    await expect(values<FilePathCommand[]>(canvasElement, "Commands")).toEqual(
      []
    )
    await userEvent.click(popup.getByRole("button", { name: "Move" }))
    await waitFor(() =>
      expect(
        values<FilePathCommand[]>(canvasElement, "Commands")[0]
      ).toMatchObject({
        action: "move",
        parentId: filePickerFolder.id,
        entry: { id: file.id, revision: 1 },
      })
    )
  },
}
export const ArabicKeyboardRename: Story = {
  globals: { locale: "ar" },
  render: () => <NameFixture />,
  play: async ({ canvasElement }) => {
    const popup = await openForm(canvasElement)
    const name = popup.getByRole("textbox", { name: "الاسم" })
    await expect(name.closest("[dir]")).toHaveAttribute("dir", "rtl")
    await userEvent.clear(name)
    await userEvent.type(name, "وثائق")
    await userEvent.keyboard("{Enter}")
    await waitFor(() =>
      expect(values<FilePathCommand[]>(canvasElement, "Commands")).toHaveLength(
        1
      )
    )
  },
}
function DeleteFixture({
  references = 0,
  stale = false,
  action = "trash",
}: {
  references?: number
  stale?: boolean
  action?: "trash" | "purge"
}) {
  const [open, setOpen] = useState(false)
  const [calls, setCalls] = useState<FilePathCommand[]>([])
  const [revision, setRevision] = useState(1)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const entry = {
    ...folder,
    state: action === "purge" ? ("trashed" as const) : ("active" as const),
  }
  // i18next-instrument-ignore
  return (
    <main className="space-y-4 p-6">
      <Button ref={trigger} onClick={() => setOpen(true)}>
        Open confirmation
      </Button>
      <output aria-label="Commands">{JSON.stringify(calls)}</output>
      <FileDeleteDialog
        action={action}
        entry={entry}
        authorizationVersion={1}
        contentScopeKey={`delete-${action}-${references}-${stale}`}
        open={open}
        canSubmit
        execute={async (command) => {
          setCalls((current) => [...current, command])
        }}
        readEntry={async () => {
          setRevision(2)
          return { ...entry, revision: 2 }
        }}
        readImpact={async () =>
          FileEntryImpactSchema.parse({
            entryId: folder.id,
            revision: stale ? 2 : revision,
            fileCount: 3,
            folderCount: 2,
            bytes: 128,
            referenceCount: references,
          })
        }
        onClose={() => setOpen(false)}
        returnFocus={() => trigger.current}
      />
    </main>
  )
}
async function openConfirmation(canvas: HTMLElement) {
  await userEvent.click(
    within(canvas).getByRole("button", { name: "Open confirmation" })
  )
  const dialog = await within(document.body).findByRole("dialog")
  await waitFor(() => expect(dialog).toBeVisible())
  return within(dialog)
}
export const ReferencedSubtreeCannotBeTrashed: Story = {
  render: () => <DeleteFixture references={4} />,
  play: async ({ canvasElement }) => {
    const popup = await openConfirmation(canvasElement)
    await expect(
      await popup.findByText("3 files · 2 folders · 128 bytes")
    ).toBeVisible()
    await expect(popup.getByRole("alert")).toHaveTextContent(
      /Business references: 4/
    )
    await expect(
      popup.getByRole("button", { name: "Move to trash" })
    ).toBeDisabled()
    await expect(values<FilePathCommand[]>(canvasElement, "Commands")).toEqual(
      []
    )
  },
}
export const StaleImpactRequiresExplicitRefresh: Story = {
  render: () => <DeleteFixture stale />,
  play: async ({ canvasElement }) => {
    const popup = await openConfirmation(canvasElement)
    await waitFor(() =>
      expect(
        popup.getByRole("button", { name: "Move to trash" })
      ).toBeDisabled()
    )
    await userEvent.click(popup.getByRole("button", { name: "Refresh entry" }))
    await waitFor(() =>
      expect(popup.getByRole("button", { name: "Move to trash" })).toBeEnabled()
    )
    await userEvent.click(popup.getByRole("button", { name: "Move to trash" }))
    await waitFor(() =>
      expect(
        values<FilePathCommand[]>(canvasElement, "Commands")[0]
      ).toMatchObject({
        action: "trash",
        entry: { revision: 2 },
      })
    )
  },
}
export const PermanentDeleteShowsActualImpact: Story = {
  render: () => <DeleteFixture action="purge" />,
  play: async ({ canvasElement }) => {
    const popup = await openConfirmation(canvasElement)
    await expect(
      await popup.findByText("3 files · 2 folders · 128 bytes")
    ).toBeVisible()
    await expect(popup.getByText(/cannot be undone/i)).toBeVisible()
    await userEvent.click(
      popup.getByRole("button", { name: "Delete permanently" })
    )
    await waitFor(() =>
      expect(
        values<FilePathCommand[]>(canvasElement, "Commands")[0]
      ).toMatchObject({ action: "purge" })
    )
  },
}
