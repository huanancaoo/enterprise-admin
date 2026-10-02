import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, within } from "storybook/test"
import {
  FileVersionReferenceSchema,
  type FileVersionReference,
} from "@workspace/contracts"
import {
  UploadQueue,
  type FileUploadJobView,
  type FileUploadStatus,
} from "./upload-queue"

const id = (value: number) =>
  `12b09a98-1cfa-4b40-8c1a-${String(value).padStart(12, "0")}`
const item = (status: FileUploadStatus, index = 1): FileUploadJobView => ({
  id: id(index),
  action: "upload",
  createdAt: "2026-10-01T00:00:00.000Z",
  status,
  name: "Selected.txt",
  bytes: 0,
  canRetry: status === "failed",
  hasFile: true,
  isChecking: false,
  result:
    status === "completed"
      ? { entryId: id(50), versionId: id(51), revision: 2 }
      : null,
})
function QueueFixture({
  states = ["committed"],
  restored = false,
  checking = false,
}: {
  states?: FileUploadStatus[]
  restored?: boolean
  checking?: boolean
}) {
  const [jobs, setJobs] = useState(
    states.map((status, index) => ({
      ...item(status, index + 1),
      ...(restored
        ? { name: undefined, bytes: undefined, hasFile: false, canRetry: false }
        : {}),
      isChecking: checking,
    }))
  )
  const [action, setAction] = useState<unknown>()
  // i18next-instrument-ignore
  return (
    <div className="p-6">
      <output aria-label="Queue action">{JSON.stringify(action)}</output>
      <UploadQueue
        jobs={jobs}
        onCheck={(operationId) => setAction({ type: "check", operationId })}
        onRetry={(operationId) => setAction({ type: "retry", operationId })}
        onDismiss={(operationId) => {
          setAction({ type: "dismiss", operationId })
          setJobs((current) => current.filter((job) => job.id !== operationId))
        }}
        onOpenResult={(reference: FileVersionReference) =>
          setAction({
            type: "view",
            reference: FileVersionReferenceSchema.parse(reference),
          })
        }
      />
    </div>
  )
}
const meta = {
  title: "Tenant/Upload queue",
  component: QueueFixture,
  globals: { locale: "en-US" },
} satisfies Meta<typeof QueueFixture>
export default meta
type Story = StoryObj<typeof meta>
export const CommittedIsSavedWhileCleanupRemains: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      within(canvas.getByRole("list")).getByRole("status")
    ).toHaveTextContent("Saved, cleaning up")
    await expect(
      canvas.queryByText("Upload completed", { exact: true })
    ).not.toBeInTheDocument()
    await expect(canvas.queryByRole("progressbar")).not.toBeInTheDocument()
    await expect(
      canvas.queryByRole("button", { name: "Remove local task record" })
    ).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole("button", { name: "Check status" }))
    await expect(canvas.getByLabelText("Queue action")).toHaveTextContent(
      JSON.stringify({ type: "check", operationId: id(1) })
    )
  },
}
export const UnknownResultOnlyChecksOriginalIdentity: Story = {
  args: { states: ["unconfirmed"], restored: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.queryByText("Selected.txt", { exact: true })
    ).not.toBeInTheDocument()
    await expect(
      canvas.queryByText(id(1), { exact: false })
    ).not.toBeInTheDocument()
    await expect(
      canvas.queryByRole("button", { name: "Upload again" })
    ).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole("button", { name: "Check status" }))
    await expect(canvas.getByLabelText("Queue action")).toHaveTextContent(id(1))
  },
}
export const FailedRetryIsExplicitAndDoesNotClearRecord: Story = {
  args: { states: ["failed"] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText("Queue action")).toBeEmptyDOMElement()
    await userEvent.click(canvas.getByRole("button", { name: "Upload again" }))
    await expect(canvas.getByLabelText("Queue action")).toHaveTextContent(
      JSON.stringify({ type: "retry", operationId: id(1) })
    )
    await expect(
      within(canvas.getByRole("list")).getByRole("status")
    ).toHaveTextContent("Upload did not complete")
  },
}
export const RestoredFailureRequiresNewFileSelection: Story = {
  args: { states: ["failed"], restored: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/File contents were not kept/)).toBeVisible()
    await expect(
      canvas.queryByRole("button", { name: "Upload again" })
    ).not.toBeInTheDocument()
  },
}
export const LocalUnsubmittedRecordCanBeRemoved: Story = {
  args: { states: ["needs-file", "unconfirmed"], restored: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole("button", { name: "Remove local task record" })
    )
    await expect(canvas.getByLabelText("Queue action")).toHaveTextContent(
      JSON.stringify({ type: "dismiss", operationId: id(1) })
    )
    await expect(
      canvas.getByRole("heading", { name: "Upload tasks" })
    ).toHaveFocus()
    await expect(canvas.getAllByRole("listitem")).toHaveLength(1)
  },
}
export const CompletedOpensItsFixedUploadedVersion: Story = {
  args: { states: ["completed"] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole("button", { name: "View uploaded version" })
    )
    await expect(canvas.getByLabelText("Queue action")).toHaveTextContent(
      JSON.stringify({
        type: "view",
        reference: { fileId: id(50), versionId: id(51) },
      })
    )
  },
}
export const CheckingCannotSubmitAnotherRead: Story = {
  args: { states: ["unconfirmed"], checking: true },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("button", { name: "Loading…" })
    ).toBeDisabled()
  },
}
export const ArabicStagesUseRtl: Story = {
  globals: { locale: "ar" },
  args: { states: ["committed"] },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.ownerDocument.documentElement).toHaveAttribute(
      "dir",
      "rtl"
    )
    await expect(
      within(within(canvasElement).getByRole("list")).getByRole("status")
    ).toHaveTextContent("تم الحفظ، جارٍ التنظيف")
  },
}
