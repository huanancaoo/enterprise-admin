import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, spyOn, userEvent, waitFor, within } from "storybook/test"
import {
  createFileContentScenario,
  fileContentBytes,
  filePickerImage,
} from "@workspace/mocks"
import { Button } from "@workspace/ui/components/button"
import { FileDownloadButton, type FileContentTarget } from "./file-content"

const target: FileContentTarget = {
  file: { ...filePickerImage, name: "stale-page-name.bin" },
  version: filePickerImage.currentVersion,
}
function DownloadFixture() {
  const [mounted, setMounted] = useState(true)
  // i18next-instrument-ignore
  return (
    <main className="space-y-4 p-6">
      <Button onClick={() => setMounted(false)}>Leave authorized scope</Button>
      {mounted && <FileDownloadButton target={target} />}
    </main>
  )
}

function scenario(
  header: string,
  outcome: "success" | "denied" | "pending" = "success"
) {
  const content = createFileContentScenario(header, outcome)
  const downloads: Array<{ filename: string; url: string }> = []
  const blobs: Blob[] = []
  const urls: string[] = []
  const revoked: string[] = []
  let wasAborted = () => false
  return {
    requests: content.requests,
    downloads,
    blobs,
    urls,
    revoked,
    wasAborted: () => wasAborted(),
    parameters: { msw: { handlers: content.handlers } },
    beforeEach: () => {
      content.reset()
      downloads.length = blobs.length = urls.length = revoked.length = 0
      const nativeCreate = URL.createObjectURL.bind(URL)
      const nativeRevoke = URL.revokeObjectURL.bind(URL)
      const read = spyOn(globalThis, "fetch")
      wasAborted = () =>
        read.mock.calls.some(([, init]) => init?.signal?.aborted)
      const create = spyOn(URL, "createObjectURL").mockImplementation(
        (value) => {
          blobs.push(value as Blob)
          const url = nativeCreate(value)
          urls.push(url)
          return url
        }
      )
      const revoke = spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
        revoked.push(url)
        nativeRevoke(url)
      })
      const click = spyOn(
        HTMLAnchorElement.prototype,
        "click"
      ).mockImplementation(function (this: HTMLAnchorElement) {
        // 保留真实 Blob URL，观察组件交付的文件名与字节，避免 Story 触发磁盘下载。
        downloads.push({ filename: this.download, url: this.href })
      })
      return () => {
        read.mockRestore()
        create.mockRestore()
        revoke.mockRestore()
        click.mockRestore()
      }
    },
  }
}

const meta = {
  title: "Tenant/Protected file download",
  component: DownloadFixture,
  globals: { locale: "en-US" },
} satisfies Meta<typeof DownloadFixture>
export default meta
type Story = StoryObj<typeof meta>

function downloadStory(header: string, filename: string): Story {
  const fixture = scenario(header)
  return {
    beforeEach: fixture.beforeEach,
    parameters: fixture.parameters,
    play: async ({ canvasElement }) => {
      const canvas = within(canvasElement)
      await userEvent.click(
        canvas.getByRole("button", { name: "Download file" })
      )
      await waitFor(() => expect(fixture.downloads).toHaveLength(1))
      await expect(fixture.downloads[0]).toEqual({
        filename,
        url: fixture.urls[0],
      })
      await expect(
        new Uint8Array(await fixture.blobs[0]!.arrayBuffer())
      ).toEqual(fileContentBytes)
      await expect(fixture.blobs[0]!.type).toBe("application/octet-stream")
      const request = new URL(fixture.requests[0]!.url)
      await expect(request.pathname).toBe(
        `/api/v1/organizations/${target.file.organizationId}/files/entries/${target.file.id}/versions/${target.version.id}/content`
      )
      await expect(request.searchParams.get("disposition")).toBe("attachment")
      await waitFor(() => expect(fixture.revoked).toEqual(fixture.urls))
      await expect(canvas.queryByRole("alert")).not.toBeInTheDocument()
    },
  }
}

export const AsciiTokenFilename = downloadStory(
  "attachment; filename=maximum.bin",
  "maximum.bin"
)
export const QuotedFilename = downloadStory(
  'attachment; filename="report; approved.bin"',
  "report; approved.bin"
)
export const Utf8FilenameOverridesOrdinaryParameter = downloadStory(
  "attachment; filename=report.bin; filename*=UTF-8''%E6%8A%A5%E5%91%8A.bin",
  "报告.bin"
)

const missing = scenario("attachment")
export const MissingAuthorizedFilenameDoesNotUsePageName: Story = {
  beforeEach: missing.beforeEach,
  parameters: missing.parameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Download file" }))
    await waitFor(() =>
      expect(canvas.getByRole("alert")).toHaveTextContent(
        "The action failed. Please try again."
      )
    )
    await expect(missing.downloads).toEqual([])
    await expect(missing.blobs).toEqual([])
  },
}
const denied = scenario("attachment; filename=private.bin", "denied")
export const RemovedAuthorizationDoesNotCreateDownload: Story = {
  beforeEach: denied.beforeEach,
  parameters: denied.parameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Download file" }))
    await waitFor(() =>
      expect(canvas.getByRole("alert")).toHaveTextContent(
        "File access was removed"
      )
    )
    await expect(denied.downloads).toEqual([])
    await expect(denied.blobs).toEqual([])
  },
}
const pending = scenario("attachment; filename=private.bin", "pending")
export const ScopeUnmountAbortsProtectedRead: Story = {
  beforeEach: pending.beforeEach,
  parameters: pending.parameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Download file" }))
    await waitFor(() => expect(pending.requests).toHaveLength(1))
    await expect(
      canvas.getByRole("button", { name: "Preparing download…" })
    ).toBeDisabled()
    await userEvent.click(
      canvas.getByRole("button", { name: "Leave authorized scope" })
    )
    await waitFor(() => expect(pending.wasAborted()).toBe(true))
    await expect(pending.downloads).toEqual([])
    await expect(pending.blobs).toEqual([])
  },
}
