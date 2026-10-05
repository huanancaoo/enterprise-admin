import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { getOrganizationAccessOptions } from "@workspace/api-client"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, spyOn, userEvent, waitFor, within } from "storybook/test"
import {
  createFileContentScenario,
  fileContentBytes,
  filePickerImage,
} from "@workspace/mocks"
import { Button } from "@workspace/ui/components/button"
import { useUiLocale } from "@workspace/i18n/react"
import { ProjectFileEditor } from "../projects/project-file-editor"
import { FileDownloadButton, type FileContentTarget } from "./file-content"
import { createProjectFilePorts } from "../projects/project-content-ports"

const target: FileContentTarget = {
  file: { ...filePickerImage, name: "stale-page-name.bin" },
  version: filePickerImage.currentVersion,
}
function ProjectAttachmentFixture({
  contentScopeKey,
}: {
  contentScopeKey: string
}) {
  const locale = useUiLocale()
  const ports = createProjectFilePorts(target.file.organizationId, locale)
  return (
    <ProjectFileEditor
      userId="00000000-0000-4000-8000-000000000001"
      organizationId={target.file.organizationId}
      authorizationVersion={1}
      canBrowse={false}
      canUpload={false}
      contentScopeKey={contentScopeKey}
      value={{
        type: "doc",
        content: [
          {
            type: "fileAttachment",
            attrs: {
              fileId: target.file.id,
              versionId: target.version.id,
              label: "Cached project attachment",
            },
          },
        ],
      }}
      ports={ports}
    />
  )
}
function AccessProjectionFixture() {
  const access = useQuery(
    getOrganizationAccessOptions(target.file.organizationId)
  )
  // i18next-instrument-ignore
  return (
    <p role="status">
      Organization authorization revision{" "}
      {access.data?.status === 200
        ? access.data.data.authorizationVersion
        : "loading"}
    </p>
  )
}
function DownloadFixture({
  project = false,
  observeAccess = false,
}: {
  project?: boolean
  observeAccess?: boolean
}) {
  const [mounted, setMounted] = useState(true)
  const [scope, setScope] = useState(0)
  // i18next-instrument-ignore
  return (
    <main className="space-y-4 p-6">
      <Button onClick={() => setMounted(false)}>Leave authorized scope</Button>
      {observeAccess && <AccessProjectionFixture />}
      {project && (
        <Button onClick={() => setScope((value) => value + 1)}>
          Change content scope
        </Button>
      )}
      {mounted &&
        (project ? (
          <ProjectAttachmentFixture
            contentScopeKey={"project-download-" + scope}
          />
        ) : (
          <FileDownloadButton target={target} />
        ))}
    </main>
  )
}

function scenario(
  header: string,
  outcome: "success" | "denied" | "pending" | "network-error" = "success",
  downloadFailure = false
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
        if (downloadFailure) throw new Error("Browser download rejected")
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

function downloadButtonName(
  project: boolean,
  locale: "en-US" | "zh-CN" = "en-US"
) {
  return project
    ? locale === "zh-CN"
      ? "下载 Cached project attachment"
      : "Download Cached project attachment"
    : locale === "zh-CN"
      ? "下载文件"
      : "Download file"
}
function downloadStory(
  header: string,
  filename: string,
  project = false,
  locale: "en-US" | "zh-CN" = "en-US"
): Story {
  const fixture = scenario(header)
  return {
    args: { project },
    globals: { locale },
    beforeEach: fixture.beforeEach,
    parameters: fixture.parameters,
    play: async ({ canvasElement }) => {
      const canvas = within(canvasElement)
      await userEvent.click(
        await canvas.findByRole("button", {
          name: downloadButtonName(project, locale),
        })
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
      await expect(fixture.requests[0]!.headers.get("Accept-Language")).toBe(
        locale
      )
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
export const ProjectRichTextAttachmentUsesAuthorizedAsciiFilename =
  downloadStory(
    "attachment; filename=project-attachment.bin",
    "project-attachment.bin",
    true
  )

export const ProjectRichTextAttachmentUsesQuotedFilename = downloadStory(
  'attachment; filename="report; approved.bin"',
  "report; approved.bin",
  true
)
export const ProjectRichTextAttachmentUsesUtf8Filename = downloadStory(
  "attachment; filename=report.bin; filename*=UTF-8''%E6%8A%A5%E5%91%8A.bin",
  "报告.bin",
  true
)
export const CurrentUiLanguageInFileDownload = downloadStory(
  "attachment; filename=maximum.bin",
  "maximum.bin",
  false,
  "zh-CN"
)
export const CurrentUiLanguageInProjectDownload = downloadStory(
  "attachment; filename=maximum.bin",
  "maximum.bin",
  true,
  "zh-CN"
)

function failedDownloadStory(
  fixture: ReturnType<typeof scenario>,
  message: string,
  project = false
): Story {
  return {
    args: { project },
    beforeEach: fixture.beforeEach,
    parameters: fixture.parameters,
    play: async ({ canvasElement }) => {
      const canvas = within(canvasElement)
      await userEvent.click(
        await canvas.findByRole("button", { name: downloadButtonName(project) })
      )
      await waitFor(() =>
        expect(canvas.getByRole("alert")).toHaveTextContent(message)
      )
      await expect(fixture.downloads).toEqual([])
      await expect(fixture.blobs).toEqual([])
    },
  }
}
export const MissingAuthorizedFilenameDoesNotUsePageName = failedDownloadStory(
  scenario("attachment"),
  "The action failed. Please try again."
)
export const ProjectMissingAuthorizedFilenameDoesNotUsePageName =
  failedDownloadStory(
    scenario("attachment"),
    "The action failed. Please try again.",
    true
  )
export const RemovedAuthorizationDoesNotCreateDownload = failedDownloadStory(
  scenario("attachment; filename=private.bin", "denied"),
  "File access was removed"
)
export const ProjectRemovedAuthorizationDoesNotCreateDownload =
  failedDownloadStory(
    scenario("attachment; filename=private.bin", "denied"),
    "File access was removed",
    true
  )
export const NetworkFailureDoesNotCreateDownload = failedDownloadStory(
  scenario("attachment; filename=private.bin", "network-error"),
  "The action failed. Please try again."
)
export const ProjectNetworkFailureDoesNotCreateDownload = failedDownloadStory(
  scenario("attachment; filename=private.bin", "network-error"),
  "The action failed. Please try again.",
  true
)

function cancelledDownloadStory(project = false, changeScope = false): Story {
  const fixture = scenario("attachment; filename=private.bin", "pending")
  return {
    args: { project },
    beforeEach: fixture.beforeEach,
    parameters: fixture.parameters,
    play: async ({ canvasElement }) => {
      const canvas = within(canvasElement)
      await userEvent.click(
        await canvas.findByRole("button", { name: downloadButtonName(project) })
      )
      await waitFor(() => expect(fixture.requests).toHaveLength(1))
      await expect(
        canvas.getByRole("button", {
          name: project ? downloadButtonName(project) : "Preparing download…",
        })
      ).toBeDisabled()
      await userEvent.click(
        canvas.getByRole("button", {
          name: changeScope ? "Change content scope" : "Leave authorized scope",
        })
      )
      await waitFor(() => expect(fixture.wasAborted()).toBe(true))
      await expect(fixture.downloads).toEqual([])
      await expect(fixture.blobs).toEqual([])
    },
  }
}
export const ScopeUnmountAbortsProtectedRead = cancelledDownloadStory()
export const ProjectScopeUnmountAbortsProtectedRead =
  cancelledDownloadStory(true)
export const ProjectContentScopeChangeAbortsProtectedRead =
  cancelledDownloadStory(true, true)

function browserFailureStory(project = false): Story {
  const fixture = scenario("attachment; filename=private.bin", "success", true)
  return {
    args: { project },
    beforeEach: fixture.beforeEach,
    parameters: fixture.parameters,
    play: async ({ canvasElement }) => {
      const canvas = within(canvasElement)
      await userEvent.click(
        await canvas.findByRole("button", { name: downloadButtonName(project) })
      )
      await waitFor(() =>
        expect(canvas.getByRole("alert")).toHaveTextContent(
          "The action failed. Please try again."
        )
      )
      await expect(fixture.urls).toHaveLength(1)
      await waitFor(() => expect(fixture.revoked).toEqual(fixture.urls))
      await expect(fixture.downloads).toEqual([])
    },
  }
}
export const BrowserDownloadFailureReleasesTemporaryUrl = browserFailureStory()
export const ProjectBrowserDownloadFailureReleasesTemporaryUrl =
  browserFailureStory(true)

const deniedProjection = scenario("attachment; filename=private.bin", "denied")
export const DownloadDeniedRefreshesOrganizationAuthorization: Story = {
  args: { observeAccess: true },
  beforeEach: deniedProjection.beforeEach,
  parameters: deniedProjection.parameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText("Organization authorization revision 1")
    await userEvent.click(canvas.getByRole("button", { name: "Download file" }))
    await canvas.findByText("Organization authorization revision 2")
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "File access was removed"
    )
    await expect(deniedProjection.downloads).toEqual([])
    await expect(deniedProjection.blobs).toEqual([])
  },
}
