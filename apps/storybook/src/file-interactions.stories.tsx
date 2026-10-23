import { createContext, useContext, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import {
  FilePathOperations,
  FileUploads,
  type FileUploadActions,
  type FilePathActions,
} from "@workspace/admin/files"
import { FileOperationResponseSchema } from "@workspace/contracts"
import { filePickerRoot, filePickerFolder } from "@workspace/mocks"
import { Button } from "@workspace/ui/components/button"

const UploadContext = createContext<FileUploadActions | null>(null)
const PathContext = createContext<FilePathActions<
  typeof filePickerFolder
> | null>(null)
function UploadTrigger() {
  const actions = useContext(UploadContext)!
  // i18next-instrument-ignore
  return (
    <Button
      id={actions.uploadTriggerId}
      onClick={() => actions.onUpload(filePickerRoot)}
    >
      Upload file
    </Button>
  )
}
function PathTrigger() {
  const actions = useContext(PathContext)!
  // i18next-instrument-ignore
  return (
    <Button
      id={`${actions.pathTriggerId}-rename`}
      disabled={!actions.canPerform(filePickerFolder, "rename")}
      onClick={() => actions.onAction(filePickerFolder, "rename")}
    >
      Rename folder
    </Button>
  )
}

function Interactions({ mode }: { mode: "upload" | "path" }) {
  const [scope] = useState(() => crypto.randomUUID())
  const finished = useRef(false)
  const reads = useRef(0)
  const [submitted, setSubmitted] = useState(false)
  const queryKey = ["file-interactions", scope]
  const workspace = useQuery({
    queryKey,
    queryFn: async () => ++reads.current,
    staleTime: Infinity,
  })
  const receipt = (id: string) =>
    FileOperationResponseSchema.parse({
      id,
      action: mode === "upload" ? "upload" : "rename",
      phase: finished.current ? "completed" : "cleaning",
      committedAt: "2026-10-01T00:00:00.000Z",
      completedAt: finished.current ? "2026-10-01T00:00:00.000Z" : null,
      errorCode: null,
      result: { entryId: filePickerFolder.id, revision: 2 },
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    })
  const submit = async (id: string) => {
    setSubmitted(true)
    return receipt(id)
  }
  // i18next-instrument-ignore
  return (
    <div className="space-y-4">
      <output aria-label="Workspace reads">{workspace.data}</output>
      <output aria-label="Published">{String(submitted)}</output>
      <Button
        onClick={() => {
          finished.current = true
        }}
      >
        Finish cleanup
      </Button>
      {mode === "upload" ? (
        <FileUploads
          ActionsContext={UploadContext}
          contentScopeKey={scope}
          canUpload
          canOverwrite={false}
          onOpenVersion={() => undefined}
          adapter={{
            userId: scope,
            ownerKey: scope,
            completedQueryKeys: [queryKey],
            upload: (fields) => submit(fields.operationId),
            overwrite: async () => {
              throw new Error("Overwrite is not part of this scenario")
            },
            readOperation: async (id) => receipt(id),
            readEntry: async () => filePickerRoot,
          }}
        >
          <UploadTrigger />
        </FileUploads>
      ) : (
        <FilePathOperations
          ActionsContext={PathContext}
          contentScopeKey={scope}
          root={filePickerRoot}
          renderFolderPicker={() => null}
          renderReferences={() => null}
          adapter={{
            userId: scope,
            ownerKey: scope,
            queryKey,
            canShow: () => true,
            canPerform: () => true,
            submit: (_action, _id, body) => submit(body.operationId),
            readOperation: async (id) => receipt(id),
            readEntry: async () => filePickerFolder,
            readImpact: async () => {
              throw new Error("Deletion is not part of this scenario")
            },
          }}
        >
          <PathTrigger />
        </FilePathOperations>
      )}
    </div>
  )
}

const meta = {
  title: "Admin/Files/Interactions",
  component: Interactions,
  globals: { locale: "en-US" },
} satisfies Meta<typeof Interactions>
export default meta
type Story = StoryObj<typeof meta>

export const UploadRefreshesAfterCleanup: Story = {
  args: { mode: "upload" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    await waitFor(() =>
      expect(canvas.getByLabelText("Workspace reads")).toHaveTextContent("1")
    )
    const trigger = canvas.getByRole("button", { name: "Upload file" })
    await userEvent.click(trigger)
    let dialog = within(await body.findByRole("dialog"))
    await userEvent.click(dialog.getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(trigger).toHaveFocus())
    await userEvent.click(trigger)
    dialog = within(await body.findByRole("dialog"))
    await userEvent.upload(
      dialog.getByLabelText("Choose files"),
      new File(["abc"], "Notes.txt", { type: "text/plain" })
    )
    await userEvent.click(dialog.getByRole("button", { name: "Start upload" }))
    await waitFor(() =>
      expect(canvas.getByLabelText("Published")).toHaveTextContent("true")
    )
    // 已发布但仍在清理时，上传不会提前刷新；正式完成才刷新一次。
    await expect(canvas.getByLabelText("Workspace reads")).toHaveTextContent(
      "1"
    )
    await userEvent.click(
      canvas.getByRole("button", { name: "Finish cleanup" })
    )
    await waitFor(
      () =>
        expect(canvas.getByLabelText("Workspace reads")).toHaveTextContent("2"),
      { timeout: 5000 }
    )
  },
}

export const PathRefreshesOnPublicationAndKeepsActionLocked: Story = {
  args: { mode: "path" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    await waitFor(() =>
      expect(canvas.getByLabelText("Workspace reads")).toHaveTextContent("1")
    )
    const trigger = canvas.getByRole("button", { name: "Rename folder" })
    await userEvent.click(trigger)
    const dialog = within(await body.findByRole("dialog"))
    await userEvent.clear(dialog.getByLabelText("Name"))
    await userEvent.type(dialog.getByLabelText("Name"), "Renamed")
    await userEvent.click(dialog.getByRole("button", { name: "Rename" }))
    await waitFor(() =>
      expect(canvas.getByLabelText("Workspace reads")).toHaveTextContent("2")
    )
    await expect(trigger).toBeDisabled()
    await userEvent.click(
      canvas.getByRole("button", { name: "Finish cleanup" })
    )
    await waitFor(
      () =>
        expect(canvas.getByLabelText("Workspace reads")).toHaveTextContent("3"),
      { timeout: 5000 }
    )
    await expect(trigger).toBeEnabled()
  },
}
