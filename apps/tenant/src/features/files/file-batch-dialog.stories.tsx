import { useRef, useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { ApiClientError } from "@workspace/api-client"
import {
  ExecuteFileBatchSchema,
  FileBatchResponseSchema,
  FileResponseSchema,
  FolderResponseSchema,
  type ExecuteFileBatch,
  type FileBatchResponse,
  type FileEntryResponse,
} from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import { FileBatchDialog } from "./file-batch-dialog"
import { FileBatchResults } from "./file-batch-results"
import { useFileBatch, type FileBatchPorts } from "./use-file-batch"
import { fileBatchRecordKey } from "./file-batch-records"

const id = (value: number) =>
  `d938c694-95d8-45b4-9ab8-${String(value).padStart(12, "0")}`
const date = "2026-10-02T00:00:00.000Z"
const shared = {
  organizationId: id(1),
  revision: 1,
  state: "active",
  operationId: null,
  deletedAt: null,
  expiresAt: null,
  createdAt: date,
  updatedAt: date,
}
const folder = FolderResponseSchema.parse({
  ...shared,
  kind: "folder",
  id: id(2),
  parentId: id(3),
  name: "Manuals",
  path: ["Manuals"],
})
const destination = FolderResponseSchema.parse({
  ...folder,
  id: id(4),
  name: "Archive",
  path: ["Archive"],
})
const child = FileResponseSchema.parse({
  ...shared,
  kind: "file",
  id: id(5),
  parentId: folder.id,
  name: "private-child.txt",
  path: [folder.name, "private-child.txt"],
  currentVersion: {
    id: id(6),
    fileId: id(5),
    bytes: 80,
    contentType: "text/plain",
    sha256: "a".repeat(64),
    previewKind: "text",
    isCurrent: true,
    createdAt: date,
    retiredAt: null,
    expiresAt: null,
  },
})
const solo = FileResponseSchema.parse({
  ...child,
  id: id(7),
  parentId: id(3),
  name: "private-solo.txt",
  path: ["private-solo.txt"],
  currentVersion: { ...child.currentVersion, id: id(8), fileId: id(7) },
})
type Mode =
  | "complete"
  | "partial"
  | "pending"
  | "network"
  | "serverError"
  | "unreadable"
  | "unavailable"
  | "cleaning"
  | "foldersOnly"
  | "blocked"
  | "submitting"
function result(
  input: ExecuteFileBatch,
  mode: Mode,
  complete = false
): FileBatchResponse {
  const parent = input.items.findIndex((item) => item.entryId === folder.id)
  return FileBatchResponseSchema.parse({
    batchId: input.batchId,
    action: input.action,
    createdAt: date,
    items: input.items.map((item, index) => {
      const rootIndex =
        item.entryId === child.id && parent !== -1 ? parent : index
      const root = input.items[rootIndex]!
      const pending = mode === "pending" && !complete
      const unavailable = mode === "unavailable" && root.entryId === solo.id
      const failed =
        mode === "partial" &&
        root.entryId === solo.id &&
        root.expectedRevision === 1
      const cleaning = mode === "cleaning" && !complete
      const phase = failed ? "failed" : cleaning ? "cleaning" : "completed"
      return {
        index,
        entryId: item.entryId,
        requestedOperationId: item.operationId,
        rootIndex,
        operationId: root.operationId,
        state:
          index !== rootIndex
            ? "covered"
            : pending
              ? "pending"
              : unavailable
                ? "unavailable"
                : phase,
        error: failed
          ? { code: "FILE_NAME_CONFLICT" }
          : unavailable
            ? { code: "FORBIDDEN" }
            : null,
        operation:
          pending || unavailable
            ? null
            : {
                id: root.operationId,
                action: input.action,
                phase,
                committedAt: failed ? null : date,
                completedAt: phase === "completed" ? date : null,
                errorCode: failed ? "FILE_NAME_CONFLICT" : null,
                result: failed
                  ? null
                  : {
                      entryId: root.entryId,
                      revision: 2,
                      affectedEntries: root.entryId === folder.id ? 2 : 1,
                    },
                createdAt: date,
                updatedAt: date,
              },
      }
    }),
  })
}
function Content({
  scope,
  recordScope,
  mode,
  action,
  ports,
  onRefresh,
  onScopeChange,
  onAuthorizationChange,
  onAuthorizedRemount,
  onImpact,
}: {
  scope: string
  recordScope: string
  mode: Mode
  action: "move" | "trash" | "restore" | "purge"
  ports: FileBatchPorts
  onRefresh: () => void
  onScopeChange: () => void
  onAuthorizationChange: () => void
  onAuthorizedRemount: () => void
  onImpact: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [selection, setSelection] = useState<FileEntryResponse[]>(() =>
    (mode === "foldersOnly" ? [child, folder] : [child, folder, solo]).map(
      (entry) =>
        action === "restore" || action === "purge"
          ? {
              ...entry,
              state: "trashed",
              deletedAt: date,
              expiresAt: "2026-11-01T00:00:00.000Z",
            }
          : entry
    )
  )
  const trigger = useRef<HTMLButtonElement | null>(null)
  const batch = useFileBatch({
    contentScopeKey: scope,
    recordScopeKey: recordScope,
    ports,
  })
  const canAct = (entry: FileEntryResponse) =>
    mode !== "foldersOnly" || entry.kind === "folder"
  // i18next-instrument-ignore
  return (
    <div className="space-y-5 p-6">
      <Button ref={trigger} onClick={() => setOpen(true)}>
        Open batch
      </Button>
      <Button variant="outline" onClick={onRefresh}>
        Remount from safe records
      </Button>
      <Button variant="outline" onClick={onScopeChange}>
        Change identity scope
      </Button>
      <Button variant="outline" onClick={onAuthorizationChange}>
        Change authorization version
      </Button>
      <Button variant="outline" onClick={onAuthorizedRemount}>
        Remount with new authorization
      </Button>
      <output aria-label="Safe record">
        {sessionStorage.getItem(fileBatchRecordKey(recordScope))}
      </output>
      <FileBatchDialog
        open={open}
        contentScopeKey={scope}
        action={action}
        entries={selection}
        canAct={canAct}
        selectFolder={async () => destination}
        readImpact={async (entryId) => {
          onImpact(entryId)
          return {
            entryId,
            revision: 1,
            fileCount: entryId === folder.id ? 2 : 1,
            folderCount: entryId === folder.id ? 1 : 0,
            bytes: entryId === folder.id ? 160 : 80,
            referenceCount: mode === "blocked" && entryId === folder.id ? 1 : 0,
          }
        }}
        onSubmit={batch.start}
        onClose={() => setOpen(false)}
        returnFocus={() => trigger.current}
      />
      <FileBatchResults
        batch={batch}
        names={new Map(selection.map((entry) => [entry.id, entry.name]))}
        canContinue
        onRetryFailed={(entryIds) => {
          setSelection(
            [child, folder, solo]
              .filter((entry) => entryIds.includes(entry.id))
              .map((entry) => ({ ...entry, revision: entry.revision + 1 }))
          )
          setOpen(true)
        }}
      />
    </div>
  )
}
function Fixture({
  mode = "complete",
  action = "move",
}: {
  mode?: Mode
  action?: "move" | "trash" | "restore" | "purge"
}) {
  const [scope, setScope] = useState(() => "batch-story:" + crypto.randomUUID())
  const [epoch, setEpoch] = useState(0)
  const [authorizationVersion, setAuthorizationVersion] = useState(1)
  const [calls, setCalls] = useState<ExecuteFileBatch[]>([])
  const [reads, setReads] = useState<string[]>([])
  const [impacts, setImpacts] = useState<string[]>([])
  const [aborted, setAborted] = useState(false)
  const inputs = useRef(new Map<string, ExecuteFileBatch>())
  const counts = useRef(new Map<string, number>())
  const ports: FileBatchPorts = {
    execute: async (input, signal) => {
      ExecuteFileBatchSchema.parse(input)
      inputs.current.set(input.batchId, input)
      const count = (counts.current.get(input.batchId) ?? 0) + 1
      counts.current.set(input.batchId, count)
      setCalls((previous) => [...previous, input])
      if (mode === "submitting")
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
      if (mode === "network" || mode === "unreadable")
        throw new TypeError("Network response unavailable")
      if (mode === "serverError")
        throw new ApiClientError(503, {
          code: "FILE_STORAGE_UNAVAILABLE",
          requestId: crypto.randomUUID(),
          locale: "en-US",
          message: "Status must be checked.",
        })
      return result(input, mode, count > 1)
    },
    read: async (batchId) => {
      setReads((previous) => [...previous, batchId])
      if (mode === "unreadable" && authorizationVersion === 1)
        throw new ApiClientError(403, {
          code: "FORBIDDEN",
          requestId: crypto.randomUUID(),
          locale: "en-US",
          message: "Current authorization was revoked.",
        })
      return result(
        inputs.current.get(batchId)!,
        mode,
        mode === "network" || mode === "cleaning"
      )
    },
  }
  // i18next-instrument-ignore
  return (
    <>
      <output aria-label="POST requests">{JSON.stringify(calls)}</output>
      <output aria-label="GET requests">{JSON.stringify(reads)}</output>
      <output aria-label="Impact requests">{JSON.stringify(impacts)}</output>
      <output aria-label="Aborted request">{String(aborted)}</output>
      <Content
        key={epoch}
        scope={scope + ":v" + authorizationVersion}
        recordScope={scope}
        mode={mode}
        action={action}
        ports={ports}
        onRefresh={() => setEpoch((value) => value + 1)}
        onScopeChange={() => setScope("batch-story:" + crypto.randomUUID())}
        onAuthorizationChange={() =>
          setAuthorizationVersion((value) => value + 1)
        }
        onAuthorizedRemount={() => {
          setAuthorizationVersion((value) => value + 1)
          setEpoch((value) => value + 1)
        }}
        onImpact={(value) => setImpacts((previous) => [...previous, value])}
      />
    </>
  )
}
const meta = {
  title: "Tenant/File batches",
  component: Fixture,
  globals: { locale: "en-US" },
} satisfies Meta<typeof Fixture>
export default meta
type Story = StoryObj<typeof meta>
const posted = (canvas: HTMLElement): ExecuteFileBatch[] =>
  JSON.parse(within(canvas).getByLabelText("POST requests").textContent!)
const read = (canvas: HTMLElement): string[] =>
  JSON.parse(within(canvas).getByLabelText("GET requests").textContent!)
async function open(canvas: HTMLElement) {
  await userEvent.click(
    within(canvas).getByRole("button", { name: "Open batch" })
  )
  const dialog = await within(canvas.ownerDocument.body).findByRole("dialog")
  await waitFor(() => expect(dialog).toBeVisible())
  return within(dialog)
}
async function move(canvas: HTMLElement) {
  const popup = await open(canvas)
  await userEvent.click(
    popup.getByRole("button", { name: "Common destination folder" })
  )
  await userEvent.click(
    popup.getByRole("button", { name: "Move selected items" })
  )
  await waitFor(() => expect(posted(canvas)).toHaveLength(1))
}
export const OrderedSelectionAndKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const popup = await open(canvasElement)
    await userEvent.click(
      popup.getByRole("button", { name: "Move selected items" })
    )
    await expect(posted(canvasElement)).toHaveLength(0)
    await expect(
      popup.getByText("Choose a destination folder.", { exact: true })
    ).toBeVisible()
    const destinationButton = popup.getByRole("button", {
      name: "Common destination folder",
    })
    destinationButton.focus()
    await userEvent.keyboard("{Enter}")
    await expect(
      popup.getByRole("button", { name: "Common destination folder" })
    ).toHaveTextContent("Archive")
    await userEvent.click(
      popup.getByRole("button", { name: "Move selected items" })
    )
    await waitFor(() => expect(posted(canvasElement)).toHaveLength(1))
    const [input] = posted(canvasElement)
    await expect(input!.items.map((item) => item.entryId)).toEqual([
      child.id,
      folder.id,
      solo.id,
    ])
    await expect(
      new Set(input!.items.map((item) => item.operationId)).size
    ).toBe(3)
    await expect(input!).toMatchObject({ parentId: destination.id })
    await expect(
      within(canvasElement).getByText(/Handled by item 2/)
    ).toBeVisible()
    await expect(
      within(canvasElement).getByRole("button", { name: "Open batch" })
    ).toHaveFocus()
    const safe = JSON.parse(
      within(canvasElement).getByLabelText("Safe record").textContent!
    )
    await expect(Object.keys(safe[0]).sort()).toEqual([
      "action",
      "batchId",
      "createdAt",
      "itemOperationIds",
      "phase",
      "submitted",
      "updatedAt",
    ])
    await expect(JSON.stringify(safe)).not.toContain(child.name)
    await expect(JSON.stringify(safe)).not.toContain(folder.id)
  },
}
export const ExplicitOriginalContinuation: Story = {
  args: { mode: "pending" },
  play: async ({ canvasElement }) => {
    await move(canvasElement)
    const before = posted(canvasElement)[0]
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Check status" })
    )
    await waitFor(() => expect(read(canvasElement)).toHaveLength(1))
    await expect(posted(canvasElement)).toHaveLength(1)
    await userEvent.click(
      within(canvasElement).getByRole("button", {
        name: "Continue original batch",
      })
    )
    await waitFor(() => expect(posted(canvasElement)).toHaveLength(2))
    await expect(posted(canvasElement)[1]).toEqual(before)
  },
}
export const RefreshOnlyQueries: Story = {
  args: { mode: "pending" },
  play: async ({ canvasElement }) => {
    await move(canvasElement)
    const original = posted(canvasElement)[0]!
    await userEvent.click(
      within(canvasElement).getByRole("button", {
        name: "Remount from safe records",
      })
    )
    await waitFor(() => expect(read(canvasElement)).toEqual([original.batchId]))
    await expect(posted(canvasElement)).toHaveLength(1)
    await expect(
      within(canvasElement).queryByRole("button", {
        name: "Continue original batch",
      })
    ).not.toBeInTheDocument()
    await expect(
      within(canvasElement).getByText(/Only batch identities were saved/)
    ).toBeVisible()
  },
}
export const NetworkOnlyQueriesSameBatch: Story = {
  args: { mode: "network" },
  play: async ({ canvasElement }) => {
    await move(canvasElement)
    await waitFor(() =>
      expect(read(canvasElement)).toEqual([posted(canvasElement)[0]!.batchId])
    )
    await expect(posted(canvasElement)).toHaveLength(1)
    await expect(
      within(canvasElement).getAllByText("Completed", { exact: true })
    ).toHaveLength(2)
  },
}
export const ServerFailureDoesNotPostAgain: Story = {
  args: { mode: "serverError" },
  play: async ({ canvasElement }) => {
    await move(canvasElement)
    await waitFor(() => expect(read(canvasElement)).toHaveLength(1))
    await expect(read(canvasElement)[0]).toBe(posted(canvasElement)[0]!.batchId)
    await expect(posted(canvasElement)).toHaveLength(1)
  },
}
export const AuthorizationStopsPolling: Story = {
  args: { mode: "unreadable" },
  play: async ({ canvasElement }) => {
    await move(canvasElement)
    await waitFor(() =>
      expect(
        within(canvasElement).getByText(/Automatic status checks stopped/)
      ).toBeVisible()
    )
    await new Promise((resolve) => setTimeout(resolve, 1700))
    await expect(read(canvasElement)).toHaveLength(1)
    await expect(posted(canvasElement)).toHaveLength(1)
  },
}
export const UnavailableIsNotFailed: Story = {
  args: { mode: "unavailable" },
  play: async ({ canvasElement }) => {
    await move(canvasElement)
    await expect(
      within(canvasElement).getByText("Currently unavailable", { exact: true })
    ).toBeVisible()
    await expect(
      within(canvasElement).queryByText("Failed", { exact: true })
    ).not.toBeInTheDocument()
    await expect(
      within(canvasElement).queryByRole("button", {
        name: "Review failed items in a new batch",
      })
    ).not.toBeInTheDocument()
    await expect(read(canvasElement)).toHaveLength(0)
  },
}
export const FailedItemsUseFreshMetadataAndNewBatch: Story = {
  args: { mode: "partial" },
  play: async ({ canvasElement }) => {
    await move(canvasElement)
    const original = posted(canvasElement)[0]!
    await userEvent.click(
      within(canvasElement).getByRole("button", {
        name: "Review failed items in a new batch",
      })
    )
    const popup = within(
      await within(canvasElement.ownerDocument.body).findByRole("dialog")
    )
    await userEvent.click(
      popup.getByRole("button", { name: "Common destination folder" })
    )
    await userEvent.click(
      popup.getByRole("button", { name: "Move selected items" })
    )
    await waitFor(() => expect(posted(canvasElement)).toHaveLength(2))
    const next = posted(canvasElement)[1]!
    await expect(next.items).toHaveLength(1)
    await expect(next.items[0]).toMatchObject({
      entryId: solo.id,
      expectedRevision: 2,
    })
    await expect(next.batchId).not.toBe(original.batchId)
    await expect(next.items[0]!.operationId).not.toBe(
      original.items[2]!.operationId
    )
    const safe = JSON.parse(
      within(canvasElement).getByLabelText("Safe record").textContent!
    )
    await expect(safe.map((item: { batchId: string }) => item.batchId)).toEqual(
      [original.batchId, next.batchId]
    )
  },
}
export const FolderPermissionCoversChildImpact: Story = {
  args: { mode: "foldersOnly", action: "trash" },
  play: async ({ canvasElement }) => {
    const popup = await open(canvasElement)
    await waitFor(() =>
      expect(
        JSON.parse(
          within(canvasElement).getByLabelText("Impact requests").textContent!
        )
      ).toEqual([folder.id])
    )
    await expect(popup.getByText(/Handled with “Manuals”/)).toBeVisible()
    await userEvent.click(
      popup.getByRole("button", { name: "Move selected items to trash" })
    )
    await expect(posted(canvasElement)).toHaveLength(0)
    await expect(
      popup.getByText("Confirm this action before submitting.", { exact: true })
    ).toBeVisible()
    await userEvent.click(popup.getByRole("checkbox"))
    await userEvent.click(
      popup.getByRole("button", { name: "Move selected items to trash" })
    )
    await waitFor(() => expect(posted(canvasElement)).toHaveLength(1))
  },
}
export const PurgeShowsIndividualImpactChinese: Story = {
  globals: { locale: "zh-CN" },
  args: { action: "purge" },
  play: async ({ canvasElement }) => {
    const popup = await open(canvasElement)
    await waitFor(() =>
      expect(
        JSON.parse(
          within(canvasElement).getByLabelText("Impact requests").textContent!
        )
      ).toEqual([child.id, folder.id, solo.id])
    )
    await expect(popup.getByText(/父子影响不重复相加/)).toBeVisible()
    await userEvent.click(popup.getByRole("checkbox"))
    await userEvent.click(
      popup.getByRole("button", { name: "永久删除所选条目" })
    )
    await waitFor(() => expect(posted(canvasElement)).toHaveLength(1))
    await expect(posted(canvasElement)[0]!.action).toBe("purge")
  },
}
export const RestoreOriginalLocationsArabic: Story = {
  globals: { locale: "ar" },
  args: { action: "restore" },
  play: async ({ canvasElement }) => {
    const popup = await open(canvasElement)
    await expect(
      popup.getByRole("button", { name: "مجلد الوجهة المشترك" })
    ).toBeVisible()
    await expect(canvasElement.closest("[dir]")).toHaveAttribute("dir", "rtl")
    await userEvent.click(
      popup.getByRole("button", { name: "استعادة العناصر المحددة" })
    )
    await waitFor(() => expect(posted(canvasElement)).toHaveLength(1))
    await expect(posted(canvasElement)[0]).not.toHaveProperty("parentId")
  },
}
export const ScopeChangeCancelsOriginalBody: Story = {
  args: { mode: "submitting" },
  play: async ({ canvasElement }) => {
    await move(canvasElement)
    // Modal 被请求锁定；外部身份事件直接触发容器 scope 切换。
    within(canvasElement).getByText("Change identity scope").click()
    await waitFor(() =>
      expect(
        within(canvasElement).getByLabelText("Aborted request")
      ).toHaveTextContent("true")
    )
    await expect(read(canvasElement)).toHaveLength(0)
    await expect(posted(canvasElement)).toHaveLength(1)
  },
}

export const AuthorizationVersionPreservesSafeIdentities: Story = {
  args: { mode: "pending" },
  play: async ({ canvasElement }) => {
    await move(canvasElement)
    const original = posted(canvasElement)[0]!
    await userEvent.click(
      within(canvasElement).getByRole("button", {
        name: "Change authorization version",
      })
    )
    await waitFor(() => expect(read(canvasElement)).toEqual([original.batchId]))
    await expect(posted(canvasElement)).toHaveLength(1)
    await expect(
      within(canvasElement).queryByRole("button", {
        name: "Continue original batch",
      })
    ).not.toBeInTheDocument()
    const safe = JSON.parse(
      within(canvasElement).getByLabelText("Safe record").textContent!
    )
    await expect(safe[0].batchId).toBe(original.batchId)
    await expect(JSON.stringify(safe)).not.toContain(folder.id)
  },
}
export const CommittedCleanupContinuesByQuery: Story = {
  args: { mode: "cleaning" },
  play: async ({ canvasElement }) => {
    await move(canvasElement)
    await waitFor(() =>
      expect(read(canvasElement)).toEqual([posted(canvasElement)[0]!.batchId])
    )
    await expect(posted(canvasElement)).toHaveLength(1)
    await expect(
      within(canvasElement).getAllByText("Completed", { exact: true })
    ).toHaveLength(2)
    await expect(
      within(canvasElement).queryByRole("button", {
        name: "Review failed items in a new batch",
      })
    ).not.toBeInTheDocument()
  },
}
export const ReferencedFolderImpactIsExplicit: Story = {
  args: { mode: "blocked", action: "trash" },
  play: async ({ canvasElement }) => {
    const popup = await open(canvasElement)
    await waitFor(() =>
      expect(
        JSON.parse(
          within(canvasElement).getByLabelText("Impact requests").textContent!
        )
      ).toEqual([folder.id, solo.id])
    )
    await expect(popup.getByText(/Handled with “Manuals”/)).toBeVisible()
    await expect(
      popup.getByText(/This item has references and cannot be deleted/)
    ).toBeVisible()
    await expect(posted(canvasElement)).toHaveLength(0)
  },
}
export const EnglishConfirmationPreview: Story = {
  args: { mode: "blocked", action: "trash" },
}
export const ChineseConfirmationPreview: Story = {
  globals: { locale: "zh-CN" },
  args: { mode: "blocked", action: "purge" },
}
export const ArabicConfirmationPreview: Story = {
  globals: { locale: "ar" },
  args: { action: "restore" },
}

export const NewAuthorizationQueriesPreviousUnavailableBatch: Story = {
  args: { mode: "unreadable" },
  play: async ({ canvasElement }) => {
    await move(canvasElement)
    await waitFor(() =>
      expect(
        within(canvasElement).getByText(/Automatic status checks stopped/)
      ).toBeVisible()
    )
    const original = posted(canvasElement)[0]!
    await expect(read(canvasElement)).toEqual([original.batchId])
    await userEvent.click(
      within(canvasElement).getByRole("button", {
        name: "Change authorization version",
      })
    )
    await waitFor(() =>
      expect(read(canvasElement)).toEqual([original.batchId, original.batchId])
    )
    await expect(posted(canvasElement)).toHaveLength(1)
    await expect(
      within(canvasElement).getAllByText("Completed", { exact: true })
    ).toHaveLength(2)
    await expect(
      within(canvasElement).queryByRole("button", {
        name: "Continue original batch",
      })
    ).not.toBeInTheDocument()
  },
}

export const AuthorizedRemountQueriesPreviousUnavailableBatch: Story = {
  args: { mode: "unreadable" },
  play: async ({ canvasElement }) => {
    await move(canvasElement)
    await waitFor(() =>
      expect(
        within(canvasElement).getByText(/Automatic status checks stopped/)
      ).toBeVisible()
    )
    const original = posted(canvasElement)[0]!
    await expect(read(canvasElement)).toEqual([original.batchId])
    await userEvent.click(
      within(canvasElement).getByRole("button", {
        name: "Remount with new authorization",
      })
    )
    await waitFor(() =>
      expect(read(canvasElement)).toEqual([original.batchId, original.batchId])
    )
    await expect(posted(canvasElement)).toHaveLength(1)
    await expect(
      within(canvasElement).getAllByText("Completed", { exact: true })
    ).toHaveLength(2)
    await expect(
      within(canvasElement).queryByRole("button", {
        name: "Continue original batch",
      })
    ).not.toBeInTheDocument()
    const safe = JSON.parse(
      within(canvasElement).getByLabelText("Safe record").textContent!
    )
    await expect(safe[0].batchId).toBe(original.batchId)
    await expect(Object.keys(safe[0]).sort()).toEqual([
      "action",
      "batchId",
      "createdAt",
      "itemOperationIds",
      "phase",
      "submitted",
      "updatedAt",
    ])
  },
}
