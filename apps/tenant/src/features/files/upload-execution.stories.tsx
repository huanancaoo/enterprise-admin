import { useEffect, useRef, useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { ApiClientError } from "@workspace/api-client"
import {
  FileOperationResponseSchema,
  FileResponseSchema,
  FolderResponseSchema,
  type FileOperationResponse,
  type OverwriteFileFields,
  type UploadFileFields,
} from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import { UploadQueue } from "./upload-queue"
import { saveUploadRecords, uploadRecordKey } from "./upload-records"
import { useUploadQueue, type FileUploadTarget } from "./use-upload-queue"

const id = (index: number) =>
  `15b09a98-1cfa-4b40-8c1a-${String(index).padStart(12, "0")}`
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
const file = FileResponseSchema.parse({
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
    bytes: 3,
    contentType: "text/plain",
    sha256: "0".repeat(64),
    previewKind: "text",
    isCurrent: true,
    createdAt: parent.createdAt,
    retiredAt: null,
    expiresAt: null,
  },
})
type Mode =
  | "complete"
  | "overwrite"
  | "lost"
  | "pending"
  | "deniedRead"
  | "conflict"
  | "blockedStorage"
  | "restored"
  | "immediateReceipt"
type Submitted = {
  fields: UploadFileFields | OverwriteFileFields
  fileName: string
  type: string
  text: string
  target?: string
}
const error = (
  status: number,
  code: "FILE_NAME_CONFLICT" | "FORBIDDEN" | "NOT_FOUND",
  message: string
) =>
  new ApiClientError(status, {
    code,
    message,
    requestId: "storybook-operation",
    locale: "en-US",
  })
function receipt(
  operationId: string,
  action: "upload" | "overwrite",
  phase: "completed" | "committed" = "completed"
) {
  return FileOperationResponseSchema.parse({
    id: operationId,
    action,
    phase,
    committedAt: parent.createdAt,
    completedAt: phase === "completed" ? parent.createdAt : null,
    errorCode: null,
    result: { entryId: file.id, revision: 4, versionId: id(6) },
    createdAt: parent.createdAt,
    updatedAt: parent.createdAt,
  })
}
function Execution({
  userId,
  organizationId,
  mode,
  submit,
  read,
  completed,
}: {
  userId: string
  organizationId: string
  mode: Mode
  submit: (
    fields: UploadFileFields | OverwriteFileFields,
    file: File,
    signal: AbortSignal,
    target?: string
  ) => Promise<FileOperationResponse>
  read: (id: string, signal: AbortSignal) => Promise<FileOperationResponse>
  completed: (operation: FileOperationResponse) => void
}) {
  const [selectionError, setSelectionError] = useState<string>()
  const storage: Storage =
    mode === "blockedStorage"
      ? {
          length: localStorage.length,
          clear: () => localStorage.clear(),
          key: (index) => localStorage.key(index),
          getItem: (key) => localStorage.getItem(key),
          removeItem: (key) => localStorage.removeItem(key),
          setItem: () => {
            throw new DOMException("Blocked", "SecurityError")
          },
        }
      : localStorage
  const queue = useUploadQueue({
    userId,
    organizationId,
    storage,
    canUpload: true,
    canOverwrite: true,
    upload: (fields, value, signal) => submit(fields, value, signal),
    overwrite: (target, fields, value, signal) =>
      submit(fields, value, signal, target),
    readOperation: read,
    onCompleted: completed,
  })
  const target: FileUploadTarget =
    mode === "overwrite"
      ? { kind: "overwrite", target: file }
      : { kind: "upload", parent }
  const enqueue = () => {
    try {
      queue.enqueue(target, [
        {
          file: new File(["abc"], "Original.bin", {
            type: "application/octet-stream",
          }),
          name: mode === "overwrite" ? file.name : "Private.txt",
        },
        ...(mode === "complete"
          ? [
              {
                file: new File([], "Empty.txt", { type: "text/plain" }),
                name: "Empty.txt",
              },
            ]
          : []),
      ])
    } catch (failure) {
      setSelectionError((failure as Error).message)
    }
  }
  // i18next-instrument-ignore
  return (
    <>
      <Button onClick={enqueue}>Queue files</Button>
      {selectionError && <p role="alert">{selectionError}</p>}
      {queue.recordError && <p role="alert">{queue.recordError}</p>}
      <UploadQueue
        jobs={queue.jobs}
        onCheck={queue.check}
        onDismiss={queue.dismiss}
        onRetry={(operationId) => {
          const draft = queue.getRetryDraft(operationId)!
          queue.enqueue(draft, [{ file: draft.file, name: draft.name }])
        }}
      />
    </>
  )
}
function ExecutionFixture({ mode = "complete" }: { mode?: Mode }) {
  const [userId] = useState(() => crypto.randomUUID())
  const [organizationId, setOrganizationId] = useState(id(2))
  const [generation, setGeneration] = useState(0)
  const [requests, setRequests] = useState<Submitted[]>([])
  const [reads, setReads] = useState<string[]>([])
  const [completed, setCompleted] = useState<string[]>([])
  const [aborted, setAborted] = useState(false)
  const receiptAt = useRef<number | undefined>(undefined)
  const [firstReadDelay, setFirstReadDelay] = useState<number>()
  useState(() => {
    if (mode === "restored") {
      const now = parent.createdAt
      saveUploadRecords(localStorage, uploadRecordKey(userId, id(2)), [
        {
          id: id(10),
          action: "upload",
          phase: "hashing",
          submitted: false,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: id(11),
          action: "upload",
          phase: "unconfirmed",
          submitted: true,
          createdAt: now,
          updatedAt: now,
        },
      ])
    }
  })
  useEffect(
    () => () => {
      localStorage.removeItem(uploadRecordKey(userId, id(2)))
      localStorage.removeItem(uploadRecordKey(userId, id(20)))
    },
    [userId]
  )
  const submit = async (
    fields: UploadFileFields | OverwriteFileFields,
    value: File,
    signal: AbortSignal,
    target?: string
  ) => {
    const text = await value.text()
    setRequests((current) => [
      ...current,
      {
        fields,
        fileName: value.name,
        type: value.type,
        text,
        target,
      },
    ])
    if (mode === "pending")
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
    if (mode === "lost") throw new TypeError("Connection was lost")
    if (mode === "conflict")
      throw error(
        409,
        "FILE_NAME_CONFLICT",
        "A file with this name already exists"
      )
    receiptAt.current = performance.now()
    return receipt(
      fields.operationId,
      target ? "overwrite" : "upload",
      mode === "deniedRead" || mode === "immediateReceipt"
        ? "committed"
        : "completed"
    )
  }
  const read = async (operationId: string) => {
    if (receiptAt.current !== undefined) {
      const delay = performance.now() - receiptAt.current
      setFirstReadDelay((previous) => previous ?? delay)
    }
    setReads((current) => [...current, operationId])
    if (mode === "deniedRead")
      throw error(403, "FORBIDDEN", "File access was removed")
    if (mode === "restored")
      throw error(404, "NOT_FOUND", "The task was not accepted")
    return receipt(operationId, "upload")
  }
  // i18next-instrument-ignore
  return (
    <div className="space-y-4 p-6">
      <output aria-label="Submitted fields">{JSON.stringify(requests)}</output>
      <output aria-label="Read identities">{JSON.stringify(reads)}</output>
      <output aria-label="First status read delay">{firstReadDelay}</output>
      <output aria-label="Completed identities">
        {JSON.stringify(completed)}
      </output>
      <output aria-label="Scope request aborted">{String(aborted)}</output>
      <output aria-label="Storage key">{uploadRecordKey(userId, id(2))}</output>
      <Button onClick={() => setGeneration((current) => current + 1)}>
        Reload queue
      </Button>
      <Button onClick={() => setOrganizationId(id(20))}>
        Change organization
      </Button>
      <Execution
        key={JSON.stringify([organizationId, generation])}
        userId={userId}
        organizationId={organizationId}
        mode={mode}
        submit={submit}
        read={read}
        completed={(operation) =>
          setCompleted((current) => [...current, operation.id])
        }
      />
    </div>
  )
}
const meta = {
  title: "Tenant/Upload execution",
  component: ExecutionFixture,
  globals: { locale: "en-US" },
} satisfies Meta<typeof ExecutionFixture>
export default meta
type Story = StoryObj<typeof meta>
function submitted(canvasElement: HTMLElement): Submitted[] {
  return JSON.parse(
    within(canvasElement).getByLabelText("Submitted fields").textContent!
  )
}
function saved(canvasElement: HTMLElement) {
  return JSON.parse(
    localStorage.getItem(
      within(canvasElement).getByLabelText("Storage key").textContent!
    )!
  ) as Record<string, unknown>[]
}
export const OriginalFileShaAndSequentialQueue: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Queue files" }))
    await waitFor(() => expect(submitted(canvasElement)).toHaveLength(2))
    await waitFor(() =>
      expect(canvas.getByLabelText("Completed identities")).toHaveTextContent(
        submitted(canvasElement)[1]!.fields.operationId
      )
    )
    await expect(submitted(canvasElement)[0]).toMatchObject({
      fileName: "Original.bin",
      type: "application/octet-stream",
      text: "abc",
      fields: {
        name: "Private.txt",
        parentId: parent.id,
        declaredBytes: 3,
        contentSha256:
          "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      },
    })
    await expect(submitted(canvasElement)[1]!.fields).toMatchObject({
      declaredBytes: 0,
      contentSha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    })
    await expect(saved(canvasElement)).toHaveLength(2)
    for (const record of saved(canvasElement))
      await expect(Object.keys(record).sort()).toEqual([
        "action",
        "createdAt",
        "id",
        "phase",
        "submitted",
        "updatedAt",
      ])
    await expect(
      localStorage.getItem(canvas.getByLabelText("Storage key").textContent!)
    ).not.toMatch(/Private|Original|Manuals|contentSha256|"abc"|fileName/)
  },
}
export const OverwriteUsesConfirmedTargetRevision: Story = {
  args: { mode: "overwrite" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Queue files" }))
    await waitFor(() => expect(submitted(canvasElement)).toHaveLength(1))
    await expect(submitted(canvasElement)[0]).toMatchObject({
      target: file.id,
      fields: { expectedRevision: 3, declaredBytes: 3 },
    })
    await expect(
      Object.keys(submitted(canvasElement)[0]!.fields).sort()
    ).toEqual([
      "contentSha256",
      "declaredBytes",
      "expectedRevision",
      "operationId",
    ])
  },
}
export const LostResponseReadsSameUuidWithoutWritingAgain: Story = {
  args: { mode: "lost" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Queue files" }))
    await waitFor(() => expect(submitted(canvasElement)).toHaveLength(1))
    await waitFor(() =>
      expect(canvas.getByLabelText("Completed identities")).toHaveTextContent(
        submitted(canvasElement)[0]!.fields.operationId
      )
    )
    const operationId = submitted(canvasElement)[0]!.fields.operationId
    await expect(
      JSON.parse(canvas.getByLabelText("Read identities").textContent!)
    ).toEqual([operationId])
    await expect(submitted(canvasElement)).toHaveLength(1)
    await expect(
      canvas.queryByRole("button", { name: "Upload again" })
    ).not.toBeInTheDocument()
  },
}
export const NonterminalUploadReceiptIsConfirmedImmediately: Story = {
  args: { mode: "immediateReceipt" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Queue files" }))
    await waitFor(() =>
      expect(canvas.getByLabelText("Completed identities")).toHaveTextContent(
        submitted(canvasElement)[0]!.fields.operationId
      )
    )
    const operationId = submitted(canvasElement)[0]!.fields.operationId
    await expect(
      JSON.parse(canvas.getByLabelText("Read identities").textContent!)
    ).toEqual([operationId])
    await expect(submitted(canvasElement)).toHaveLength(1)
    await expect(
      Number(canvas.getByLabelText("First status read delay").textContent)
    ).toBeLessThan(1400)
  },
}
export const DeniedStatusStopsPollingAfterSavedReceipt: Story = {
  args: { mode: "deniedRead" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Queue files" }))
    await waitFor(() =>
      expect(canvas.getByRole("alert")).toHaveTextContent(
        "File access was removed"
      )
    )
    await expect(
      within(canvas.getByRole("list")).getByRole("status")
    ).toHaveTextContent("Saved, cleaning up")
    await new Promise((resolve) => setTimeout(resolve, 1700))
    await expect(
      JSON.parse(canvas.getByLabelText("Read identities").textContent!)
    ).toHaveLength(1)
    await expect(
      canvas.getByLabelText("Completed identities")
    ).toHaveTextContent("[]")
    await expect(
      canvas.queryByRole("button", { name: "Upload again" })
    ).not.toBeInTheDocument()
  },
}
export const RefreshRecoversIdentityAndAbortsOldResponse: Story = {
  args: { mode: "pending" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Queue files" }))
    await waitFor(() => expect(submitted(canvasElement)).toHaveLength(1))
    const operationId = submitted(canvasElement)[0]!.fields.operationId
    await expect(saved(canvasElement)[0]).toMatchObject({
      id: operationId,
      submitted: true,
      phase: "unconfirmed",
    })
    await userEvent.click(canvas.getByRole("button", { name: "Reload queue" }))
    await waitFor(() =>
      expect(canvas.getByLabelText("Completed identities")).toHaveTextContent(
        operationId
      )
    )
    await expect(
      canvas.getByLabelText("Scope request aborted")
    ).toHaveTextContent("true")
    await expect(submitted(canvasElement)).toHaveLength(1)
    await expect(
      canvas.queryByText("Private.txt", { exact: true })
    ).not.toBeInTheDocument()
  },
}
export const UnsubmittedRefreshNeedsFileAnd404NeverResends: Story = {
  args: { mode: "restored" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() =>
      expect(canvas.getByRole("alert")).toHaveTextContent(
        "The task was not accepted"
      )
    )
    await expect(
      JSON.parse(canvas.getByLabelText("Read identities").textContent!)
    ).toEqual([id(11)])
    await expect(
      canvas.getByText("Not submitted. Select the file again.")
    ).toBeVisible()
    await expect(canvas.getByLabelText("Submitted fields")).toHaveTextContent(
      "[]"
    )
    await expect(
      canvas.queryByRole("button", { name: "Upload again" })
    ).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole("button", { name: "Check status" }))
    await waitFor(() =>
      expect(
        JSON.parse(canvas.getByLabelText("Read identities").textContent!)
      ).toEqual([id(11), id(11)])
    )
  },
}
export const StorageFailurePreventsAnyPost: Story = {
  args: { mode: "blockedStorage" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Queue files" }))
    await expect(canvas.getByRole("alert")).toHaveTextContent("Blocked")
    await expect(canvas.getByLabelText("Submitted fields")).toHaveTextContent(
      "[]"
    )
    await expect(canvas.queryByRole("list")).not.toBeInTheDocument()
  },
}
export const ExplicitRetryMintsNewIdentityAndKeepsFailure: Story = {
  args: { mode: "conflict" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Queue files" }))
    await waitFor(() =>
      expect(canvas.getByRole("button", { name: "Upload again" })).toBeVisible()
    )
    const firstId = submitted(canvasElement)[0]!.fields.operationId
    await userEvent.click(canvas.getByRole("button", { name: "Upload again" }))
    await waitFor(() => expect(submitted(canvasElement)).toHaveLength(2))
    await expect(submitted(canvasElement)[1]!.fields.operationId).not.toBe(
      firstId
    )
    await expect(saved(canvasElement)).toHaveLength(2)
    await expect(canvas.getByLabelText("Read identities")).toHaveTextContent(
      "[]"
    )
  },
}
export const OrganizationChangeReleasesDraftAndAbortsPost: Story = {
  args: { mode: "pending" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Queue files" }))
    await waitFor(() => expect(submitted(canvasElement)).toHaveLength(1))
    await userEvent.click(
      canvas.getByRole("button", { name: "Change organization" })
    )
    await waitFor(() =>
      expect(canvas.getByLabelText("Scope request aborted")).toHaveTextContent(
        "true"
      )
    )
    await expect(canvas.queryByRole("list")).not.toBeInTheDocument()
    await expect(canvas.getByLabelText("Read identities")).toHaveTextContent(
      "[]"
    )
    await expect(saved(canvasElement)[0]).toMatchObject({
      submitted: true,
      phase: "unconfirmed",
    })
  },
}
