import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { ApiClientError } from "@workspace/api-client"
import {
  ProjectContentResponseSchema,
  ProjectRichTextDocumentSchema,
  FileOperationResponseSchema,
  type ProjectContentResponse,
  type SaveProjectContent,
  type SupportedLocale,
  type UploadFileFields,
} from "@workspace/contracts"
import {
  createFilePickerScenario,
  filePickerRoot,
  filePickerFolder,
  filePickerImage,
} from "@workspace/mocks"
import { Button } from "@workspace/ui/components/button"
import { ProjectContentPanel } from "./project-content"
import { uploadRecordKey } from "../files/upload-records"
import type {
  ProjectContentPorts,
  ProjectFilePorts,
} from "./project-content-ports"

const id = (value: number) =>
  `820ce78f-35f3-4484-ab90-${String(value).padStart(12, "0")}`
const date = "2026-10-02T00:00:00.000Z"
const userId = id(1)
const recordKey =
  uploadRecordKey(userId, filePickerRoot.organizationId) + ":project-editor"
const oldVersion = id(2)
const reference = { fileId: filePickerImage.id, versionId: oldVersion }
const textDocument = (text: string) =>
  ProjectRichTextDocumentSchema.parse({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  })
function imageBlob() {
  return new Blob(
    [
      Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP9sAAAAASUVORK5CYII="
        ),
        (character) => character.charCodeAt(0)
      ),
    ],
    { type: "image/png" }
  )
}
const imageFile = () =>
  new File([imageBlob()], "draft-image.png", { type: "image/png" })
function failure(
  status: number,
  code: "VERSION_CONFLICT" | "FORBIDDEN" | "FILE_STORAGE_UNAVAILABLE",
  message: string
) {
  return new ApiClientError(status, {
    code,
    message,
    requestId: "project-content-story",
    locale: "en-US",
  })
}
type Mode =
  | "normal"
  | "new"
  | "conflict"
  | "saveUnknown"
  | "refreshFailed"
  | "uploadUnknown"
  | "uploadFailed"
  | "slowUpload"
  | "references"
  | "readOnly"
  | "scope"
function scenario(mode: Mode = "normal") {
  const picker = createFilePickerScenario()
  const state = {
    documents: {} as Record<SupportedLocale, ProjectContentResponse>,
    saves: [] as { locale: SupportedLocale; input: SaveProjectContent }[],
    reads: [] as SupportedLocale[],
    uploads: [] as {
      fields: UploadFileFields
      bytes: number
      sha256: string
    }[],
    operations: [] as string[],
    images: [] as string[],
    downloads: [] as string[],
    aborted: 0,
    deny: false,
  }
  const reset = () => {
    picker.reset()
    localStorage.removeItem(recordKey)
    state.saves.length =
      state.reads.length =
      state.uploads.length =
      state.operations.length =
      state.images.length =
      state.downloads.length =
        0
    state.aborted = 0
    state.deny = false
    for (const locale of ["en-US", "zh-CN", "ar"] as const)
      state.documents[locale] = ProjectContentResponseSchema.parse({
        locale,
        revision: mode === "new" ? null : 1,
        updatedAt: mode === "new" ? null : date,
        document:
          mode === "new"
            ? null
            : {
                ...textDocument(
                  locale === "ar"
                    ? "نص محفوظ"
                    : locale === "zh-CN"
                      ? "已保存正文"
                      : "Server content"
                ),
                ...(["references", "readOnly", "scope"].includes(mode)
                  ? {
                      content: [
                        ...textDocument("Server content").content,
                        {
                          type: "fileImage",
                          attrs: { ...reference, alt: "Old image" },
                        },
                        {
                          type: "fileAttachment",
                          attrs: { ...reference, label: "Private document" },
                        },
                      ],
                    }
                  : {}),
              },
      })
  }
  const receipt = (operationId: string) =>
    FileOperationResponseSchema.parse({
      id: operationId,
      action: "upload",
      phase: "completed",
      committedAt: date,
      completedAt: date,
      errorCode: null,
      result: {
        entryId: filePickerImage.id,
        versionId: filePickerImage.currentVersion.id,
        revision: 1,
      },
      createdAt: date,
      updatedAt: date,
    })
  const contentPorts: ProjectContentPorts = {
    read: async (locale) => {
      state.reads.push(locale)
      if (mode === "refreshFailed" && state.saves.length)
        throw new TypeError("Network unavailable")
      return structuredClone(state.documents[locale])
    },
    save: async (locale, input) => {
      state.saves.push({ locale, input: structuredClone(input) })
      if (mode === "conflict")
        throw failure(409, "VERSION_CONFLICT", "Content revision changed")
      state.documents[locale] = ProjectContentResponseSchema.parse({
        locale,
        document: input.document,
        revision: (input.expectedRevision ?? 0) + 1,
        updatedAt: date,
      })
      if (mode === "saveUnknown") throw new TypeError("Response lost")
      return structuredClone(state.documents[locale])
    },
  }
  const filePorts: ProjectFilePorts = {
    file: async () => filePickerImage,
    versions: async () => ({
      items: [
        filePickerImage.currentVersion,
        {
          ...filePickerImage.currentVersion,
          id: oldVersion,
          isCurrent: false,
          retiredAt: date,
        },
      ],
    }),
    image: async (value, signal) => {
      state.images.push(value.versionId)
      signal.addEventListener("abort", () => state.aborted++, { once: true })
      if (mode === "readOnly" || state.deny)
        throw failure(403, "FORBIDDEN", "File content permission was revoked")
      return imageBlob()
    },
    download: async (value) => {
      state.downloads.push(value.versionId)
      if (mode === "readOnly" || state.deny)
        throw failure(403, "FORBIDDEN", "File content permission was revoked")
    },
    upload: async (fields, file, signal) => {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        await file.arrayBuffer()
      )
      state.uploads.push({
        fields,
        bytes: file.size,
        sha256: [...new Uint8Array(digest)]
          .map((value) => value.toString(16).padStart(2, "0"))
          .join(""),
      })
      if (mode === "uploadUnknown")
        throw failure(
          503,
          "FILE_STORAGE_UNAVAILABLE",
          "Upload response unavailable"
        )
      if (mode === "uploadFailed" && state.uploads.length === 1)
        throw failure(503, "FILE_STORAGE_UNAVAILABLE", "Storage unavailable")
      if (mode === "slowUpload")
        return new Promise((_, reject) =>
          signal.addEventListener(
            "abort",
            () => {
              state.aborted++
              reject(signal.reason)
            },
            { once: true }
          )
        )
      return receipt(fields.operationId)
    },
    operation: async (operationId) => {
      state.operations.push(operationId)
      if (mode === "uploadUnknown" && state.operations.length === 1)
        throw failure(
          503,
          "FILE_STORAGE_UNAVAILABLE",
          "Status temporarily unavailable"
        )
      if (mode === "uploadFailed")
        return FileOperationResponseSchema.parse({
          ...receipt(operationId),
          phase: "failed",
          committedAt: null,
          completedAt: null,
          result: null,
          errorCode: "FILE_STORAGE_UNAVAILABLE",
        })
      if (mode === "slowUpload")
        throw failure(403, "FORBIDDEN", "Cannot query operation")
      return receipt(operationId)
    },
  }
  return {
    state,
    reset,
    picker,
    contentPorts,
    filePorts,
    deny: () => {
      state.deny = true
    },
  }
}
type FixtureProps = {
  fixture: ReturnType<typeof scenario>
  locale?: SupportedLocale
}
function Fixture({ fixture, locale = "en-US" }: FixtureProps) {
  const [scope, setScope] = useState(1)
  const client = useQueryClient()
  // i18next-instrument-ignore
  return (
    <main className="space-y-4 p-6">
      <Button
        onClick={() =>
          void client.invalidateQueries({ queryKey: ["project-content"] })
        }
      >
        Background refresh
      </Button>
      <Button
        onClick={() => {
          fixture.deny()
          setScope((value) => value + 1)
        }}
      >
        Change authorization
      </Button>
      <ProjectContentPanel
        userId={userId}
        organizationId={filePickerRoot.organizationId}
        projectId={id(3)}
        authorizationVersion={scope}
        contentScopeKey={`user:organization:${scope}`}
        initialLocale={locale}
        canEdit={fixture !== readOnly}
        canBrowse={fixture !== readOnly}
        canUpload={fixture !== readOnly}
        root={filePickerRoot}
        ports={fixture.contentPorts}
        filePorts={fixture.filePorts}
      />
    </main>
  )
}
const normal = scenario()
const fresh = scenario("new")
const conflict = scenario("conflict")
const unknown = scenario("saveUnknown")
const refreshFailed = scenario("refreshFailed")
const uploadUnknown = scenario("uploadUnknown")
const uploadFailed = scenario("uploadFailed")
const slowUpload = scenario("slowUpload")
const references = scenario("references")
const readOnly = scenario("readOnly")
const scope = scenario("scope")
const meta = {
  title: "Tenant/Projects rich text content",
  component: Fixture,
  globals: { locale: "en-US" },
  args: { fixture: normal },
  beforeEach: normal.reset,
  parameters: {
    msw: { handlers: normal.picker.handlers },
    a11y: { test: "error" },
  },
} satisfies Meta<typeof Fixture>
export default meta
type Story = StoryObj<typeof meta>
const setup = (fixture: ReturnType<typeof scenario>) => ({
  args: { fixture },
  beforeEach: fixture.reset,
  parameters: { msw: { handlers: fixture.picker.handlers } },
})
async function editor(element: HTMLElement) {
  await waitFor(() =>
    expect(
      element.querySelector(".tiptap[contenteditable=true]")
    ).not.toBeNull()
  )
  return element.querySelector<HTMLElement>(".tiptap[contenteditable=true]")!
}
async function typeDraft(element: HTMLElement, text = " retained draft") {
  const input = await editor(element)
  await userEvent.click(input)
  await userEvent.type(input, text)
}
async function save(element: HTMLElement) {
  await userEvent.click(
    within(element).getByRole("button", { name: "Save content" })
  )
}
async function chooseUploadFolder(element: HTMLElement) {
  const canvas = within(element)
  await canvas.findByRole("button", { name: "Image upload folder" })
  await userEvent.click(
    canvas.getByRole("button", { name: "Image upload folder" })
  )
  const dialog = within(await within(document.body).findByRole("dialog"))
  await userEvent.click(await dialog.findByRole("button", { name: "Manuals" }))
  await dialog.findByRole("button", { name: "portrait.png" })
  await waitFor(() =>
    expect(
      dialog.getByRole("button", { name: "Use this folder" })
    ).toBeEnabled()
  )
  await userEvent.click(dialog.getByRole("button", { name: "Use this folder" }))
  await waitFor(() =>
    expect(within(document.body).queryByRole("dialog")).toBeNull()
  )
}
async function uploadImage(
  element: HTMLElement,
  method: "toolbar" | "paste" | "drop" = "toolbar"
) {
  const input = await editor(element)
  if (method === "toolbar") {
    await userEvent.click(
      within(element).getByRole("button", { name: "Image" })
    )
    await userEvent.upload(
      element.querySelector<HTMLInputElement>("input[type=file]")!,
      imageFile()
    )
  } else {
    input.focus()
    const data = new DataTransfer()
    data.items.add(imageFile())
    if (method === "paste")
      input.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        })
      )
    else {
      const rect = input.getBoundingClientRect()
      input.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: data,
          clientX: rect.x + 20,
          clientY: rect.y + 20,
        })
      )
    }
  }
}
async function uploadedAndSaved(
  element: HTMLElement,
  method: "toolbar" | "paste" | "drop"
) {
  await chooseUploadFolder(element)
  await uploadImage(element, method)
  await within(element).findByRole("img", { name: "draft-image.png" })
  await save(element)
  await waitFor(() => expect(normal.state.saves).toHaveLength(1))
  const post = normal.state.uploads[0]!
  await expect(post.fields.parentId).toBe(filePickerFolder.id)
  await expect(post.fields.declaredBytes).toBe(post.bytes)
  await expect(post.fields.contentSha256).toBe(post.sha256)
  const json = JSON.stringify(normal.state.saves[0]!.input.document)
  await expect(json).toContain(filePickerImage.currentVersion.id)
  await expect(json).not.toMatch(/blob:|data:|"src"|"href"/)
  const ledger = localStorage.getItem(recordKey)!
  await expect(ledger).not.toMatch(
    /draft-image|Manuals|parentId|sha256|document|path/
  )
}
export const SaveFormattingAndTable: Story = {
  play: async ({ canvasElement }) => {
    await typeDraft(canvasElement)
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Insert table" })
    )
    for (const [index, cell] of [
      ...canvasElement.querySelectorAll<HTMLElement>("th p"),
    ].entries())
      await userEvent.type(cell, `Column ${index + 1}`)
    await save(canvasElement)
    await within(canvasElement).findByText("Content and file references saved.")
    await expect(normal.state.saves[0]!.input.expectedRevision).toBe(1)
    await expect(
      JSON.stringify(normal.state.saves[0]!.input.document)
    ).toContain('"type":"table"')
    await expect(
      ProjectRichTextDocumentSchema.safeParse(
        normal.state.saves[0]!.input.document
      ).success
    ).toBe(true)
    await typeDraft(canvasElement, " second revision")
    await save(canvasElement)
    await waitFor(() => expect(normal.state.saves).toHaveLength(2))
    await expect(normal.state.saves[1]!.input.expectedRevision).toBe(2)
  },
}
export const MissingBodyUsesNullRevision: Story = {
  ...setup(fresh),
  play: async ({ canvasElement }) => {
    await typeDraft(canvasElement, "First body")
    await save(canvasElement)
    await waitFor(() => expect(fresh.state.saves).toHaveLength(1))
    await expect(fresh.state.saves[0]!.input.expectedRevision).toBeNull()
  },
}
export const LanguageDraftsSurviveBackgroundRefresh: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await typeDraft(canvasElement, " English draft")
    await userEvent.click(
      canvas.getByRole("button", { name: "Background refresh" })
    )
    await expect(await editor(canvasElement)).toHaveTextContent("English draft")
    await userEvent.click(
      canvas.getByRole("combobox", { name: "Content language" })
    )
    await userEvent.click(
      within(document.body).getByRole("option", { name: "العربية" })
    )
    await typeDraft(canvasElement, " Arabic draft")
    await expect(
      canvas.getByRole("group", { name: "Content" })
    ).toHaveAttribute("dir", "rtl")
    await userEvent.click(
      canvas.getByRole("combobox", { name: "Content language" })
    )
    await userEvent.click(
      await within(document.body).findByRole("option", { name: "English" })
    )
    await expect(await editor(canvasElement)).toHaveTextContent("English draft")
    await save(canvasElement)
    await waitFor(() => expect(normal.state.saves).toHaveLength(1))
    await expect(normal.state.saves[0]!.locale).toBe("en-US")
    await expect(
      JSON.stringify(normal.state.saves[0]!.input.document)
    ).not.toContain("Arabic draft")
  },
}
export const ConflictRetainsDraftUntilExplicitReload: Story = {
  ...setup(conflict),
  play: async ({ canvasElement }) => {
    await typeDraft(canvasElement)
    await save(canvasElement)
    await within(canvasElement).findByText("Content revision changed")
    await expect(await editor(canvasElement)).toHaveTextContent(
      "retained draft"
    )
    await expect(conflict.state.saves).toHaveLength(1)
    await userEvent.click(
      within(canvasElement).getByRole("button", {
        name: "Discard this language draft and reload",
      })
    )
    await waitFor(() =>
      expect(canvasElement.querySelector(".tiptap")).not.toHaveTextContent(
        "retained draft"
      )
    )
  },
}
export const LostSaveResponseDoesNotRepeatPut: Story = {
  ...setup(unknown),
  play: async ({ canvasElement }) => {
    await typeDraft(canvasElement)
    await save(canvasElement)
    await within(canvasElement).findByText(
      "The save result is unconfirmed. Your draft is retained; check the server content first."
    )
    await expect(await editor(canvasElement)).toHaveTextContent(
      "retained draft"
    )
    await expect(unknown.state.saves).toHaveLength(1)
    await userEvent.click(
      within(canvasElement).getByRole("button", {
        name: "Discard this language draft and reload",
      })
    )
    await expect(await editor(canvasElement)).toHaveTextContent(
      "retained draft"
    )
    await expect(unknown.state.saves).toHaveLength(1)
  },
}
export const CommittedSaveSurvivesReadBackFailure: Story = {
  ...setup(refreshFailed),
  play: async ({ canvasElement }) => {
    await typeDraft(canvasElement)
    await save(canvasElement)
    await within(canvasElement).findByText(
      "Content and references were saved, but refresh failed. Check the saved content before saving again."
    )
    await expect(refreshFailed.state.saves).toHaveLength(1)
    await expect(await editor(canvasElement)).toHaveTextContent(
      "retained draft"
    )
    await expect(
      within(canvasElement).getByRole("button", { name: "Save content" })
    ).toBeDisabled()
  },
}
export const ToolbarUploadsStructuredReference: Story = {
  play: async ({ canvasElement }) => uploadedAndSaved(canvasElement, "toolbar"),
}
export const PasteUploadsStructuredReference: Story = {
  play: async ({ canvasElement }) => uploadedAndSaved(canvasElement, "paste"),
}
export const DropUploadsStructuredReference: Story = {
  play: async ({ canvasElement }) => uploadedAndSaved(canvasElement, "drop"),
}
export const FailedFolderChoiceKeepsOriginalImageForExplicitRetry: Story = {
  play: async ({ canvasElement }) => {
    await uploadImage(canvasElement)
    await within(canvasElement).findByText(
      /Choose an image upload folder first\. The original image and content draft are retained\./
    )
    await expect(normal.state.uploads).toHaveLength(0)
    await chooseUploadFolder(canvasElement)
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Submit again" })
    )
    await within(canvasElement).findByRole("img", { name: "draft-image.png" })
    await expect(normal.state.uploads).toHaveLength(1)
  },
}
export const UnknownUploadOnlyQueriesOriginalOperation: Story = {
  ...setup(uploadUnknown),
  play: async ({ canvasElement }) => {
    await typeDraft(canvasElement)
    await chooseUploadFolder(canvasElement)
    await uploadImage(canvasElement)
    await waitFor(() => expect(uploadUnknown.state.operations).toHaveLength(1))
    await expect(
      within(canvasElement).getByRole("button", { name: "Save content" })
    ).toBeDisabled()
    await expect(
      within(canvasElement).queryByRole("button", { name: "Submit again" })
    ).toBeNull()
    await expect(await editor(canvasElement)).toHaveTextContent(
      "retained draft"
    )
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Check status" })
    )
    await within(canvasElement).findByRole("img", { name: "draft-image.png" })
    await expect(uploadUnknown.state.uploads).toHaveLength(1)
    await expect(uploadUnknown.state.operations).toEqual([
      uploadUnknown.state.uploads[0]!.fields.operationId,
      uploadUnknown.state.uploads[0]!.fields.operationId,
    ])
  },
}
export const FailedUploadNeedsExplicitNewOperation: Story = {
  ...setup(uploadFailed),
  play: async ({ canvasElement }) => {
    await typeDraft(canvasElement)
    await chooseUploadFolder(canvasElement)
    await uploadImage(canvasElement)
    await within(canvasElement).findByRole("button", { name: "Submit again" })
    await expect(await editor(canvasElement)).toHaveTextContent(
      "retained draft"
    )
    await expect(uploadFailed.state.uploads).toHaveLength(1)
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Submit again" })
    )
    await within(canvasElement).findByRole("img", { name: "draft-image.png" })
    await expect(uploadFailed.state.uploads).toHaveLength(2)
    await expect(uploadFailed.state.uploads[1]!.fields.operationId).not.toBe(
      uploadFailed.state.uploads[0]!.fields.operationId
    )
  },
}
export const ExplicitCancelKeepsBodyAndDoesNotInsertImage: Story = {
  ...setup(slowUpload),
  play: async ({ canvasElement }) => {
    await typeDraft(canvasElement)
    await chooseUploadFolder(canvasElement)
    await uploadImage(canvasElement)
    await waitFor(() => expect(slowUpload.state.uploads).toHaveLength(1))
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Stop waiting" })
    )
    await waitFor(() => expect(slowUpload.state.aborted).toBe(1))
    await expect(await editor(canvasElement)).toHaveTextContent(
      "retained draft"
    )
    await expect(within(canvasElement).queryByRole("img")).toBeNull()
    await expect(
      within(canvasElement).getByRole("button", { name: "Save content" })
    ).toBeEnabled()
    await expect(slowUpload.state.uploads).toHaveLength(1)
  },
}
export const FixedVersionChangesOnlyAfterExplicitChoice: Story = {
  ...setup(references),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("img", { name: "Old image" })
    await expect(references.state.images).toContain(oldVersion)
    await expect(references.state.images).not.toContain(
      filePickerImage.currentVersion.id
    )
    await userEvent.click(
      canvas.getAllByRole("button", { name: "Choose file version" })[0]!
    )
    const dialog = within(await within(document.body).findByRole("dialog"))
    await waitFor(() =>
      expect(dialog.getByRole("button", { name: "Save" })).toBeEnabled()
    )
    await userEvent.click(
      await dialog.findByRole("combobox", { name: "File version" })
    )
    await userEvent.click(
      await within(document.body).findByRole("option", {
        name: filePickerImage.currentVersion.id,
      })
    )
    await userEvent.click(dialog.getByRole("button", { name: "Save" }))
    await save(canvasElement)
    await waitFor(() => expect(references.state.saves).toHaveLength(1))
    await expect(
      references.state.saves[0]!.input.document.content.find(
        (node) => node.type === "fileImage"
      )?.attrs?.versionId
    ).toBe(filePickerImage.currentVersion.id)
    await userEvent.click(
      canvas.getAllByRole("button", { name: "Remove content reference" })[0]!
    )
    await save(canvasElement)
    await waitFor(() => expect(references.state.saves).toHaveLength(2))
    await expect(
      references.state.saves[1]!.input.document.content.filter(
        (node) => node.type === "fileImage"
      )
    ).toHaveLength(0)
    await expect(
      references.state.saves[1]!.input.document.content.filter(
        (node) => node.type === "fileAttachment"
      )
    ).toHaveLength(1)
  },
}
export const ExistingImageAndFileLinkPicker: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("button", { name: "Append an existing image" })
    for (const name of ["Append an existing image", "Append a file link"]) {
      await userEvent.click(canvas.getByRole("button", { name }))
      const dialog = within(await within(document.body).findByRole("dialog"))
      await userEvent.click(
        await dialog.findByRole("button", { name: "Manuals" })
      )
      await userEvent.click(
        await dialog.findByRole("button", { name: "portrait.png" })
      )
      await userEvent.click(dialog.getByRole("button", { name: "Use file" }))
      await waitFor(() =>
        expect(within(document.body).queryByRole("dialog")).toBeNull()
      )
    }
    await save(canvasElement)
    await waitFor(() => expect(normal.state.saves).toHaveLength(1))
    const nodes = normal.state.saves[0]!.input.document.content
    await expect(
      nodes.filter((node) => node.type === "fileImage")
    ).toHaveLength(1)
    await expect(
      nodes.filter((node) => node.type === "fileAttachment")
    ).toHaveLength(1)
  },
}
export const ProjectReadDoesNotGrantFileRead: Story = {
  ...setup(readOnly),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText("Server content")
    await canvas.findByText(/File content permission was revoked/)
    await expect(
      canvas.queryByRole("button", { name: "Save content" })
    ).toBeNull()
    await expect(canvas.queryByRole("toolbar")).toBeNull()
    await userEvent.click(
      canvas.getByRole("button", { name: "Download Private document" })
    )
    await waitFor(() => expect(readOnly.state.downloads).toEqual([oldVersion]))
    await expect(readOnly.state.saves).toHaveLength(0)
  },
}
export const AuthorizationRemountRevokesTemporaryImageUrl: Story = {
  ...setup(scope),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const image = await canvas.findByRole("img", { name: "Old image" })
    const temporary = image.getAttribute("src")!
    await expect(await fetch(temporary).then((response) => response.ok)).toBe(
      true
    )
    await typeDraft(canvasElement)
    await userEvent.click(
      canvas.getByRole("button", { name: "Change authorization" })
    )
    await canvas.findByText(/File content permission was revoked/)
    await expect(canvas.queryByRole("img")).toBeNull()
    await expect(await editor(canvasElement)).not.toHaveTextContent(
      "retained draft"
    )
    await expect(scope.state.aborted).toBeGreaterThan(0)
    await expect(fetch(temporary)).rejects.toThrow()
  },
}
export const ChineseKeyboardAndLabels: Story = {
  globals: { locale: "zh-CN" },
  args: { locale: "zh-CN" },
  play: async ({ canvasElement }) => {
    await editor(canvasElement)
    await expect(
      within(canvasElement).getByRole("combobox", { name: "内容语言" })
    ).toBeVisible()
    await userEvent.tab()
    await expect(document.activeElement).not.toBe(document.body)
  },
}
export const ArabicContentDirectionAndLabels: Story = {
  globals: { locale: "ar" },
  args: { locale: "ar" },
  play: async ({ canvasElement }) => {
    await editor(canvasElement)
    await expect(
      canvasElement.querySelector('[role="group"][dir="rtl"]')
    ).not.toBeNull()
    await expect(
      within(canvasElement).getByRole("combobox", { name: "لغة المحتوى" })
    ).toBeVisible()
  },
}

export const PickerUploadDoesNotSubmitOuterContentForm: Story = {
  play: async ({ canvasElement }) => {
    await typeDraft(canvasElement)
    await userEvent.click(
      within(canvasElement).getByRole("button", {
        name: "Append an existing image",
      })
    )
    const picker = within(await within(document.body).findByRole("dialog"))
    await userEvent.click(
      await picker.findByRole("button", { name: "Choose files" })
    )
    const upload = within(
      await within(document.body).findByRole("dialog", { name: "Upload files" })
    )
    await userEvent.upload(upload.getByLabelText("Choose files"), imageFile())
    await userEvent.click(upload.getByRole("button", { name: "Start upload" }))
    await waitFor(() => expect(normal.state.uploads).toHaveLength(1))
    await expect(normal.state.uploads[0]!.fields.parentId).toBe(
      filePickerRoot.id
    )
    await expect(normal.state.saves).toHaveLength(0)
    await expect(normal.state.documents["en-US"].revision).toBe(1)
    await userEvent.click(picker.getByRole("button", { name: "Cancel" }))
    await expect(await editor(canvasElement)).toHaveTextContent(
      "retained draft"
    )
  },
}
