import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { AuthenticatedSessionProvider } from "@workspace/admin/auth"
import type { CreateProject } from "@workspace/contracts"
import {
  createProjectAttachmentsScenario,
  createProjectHandler,
  organizations,
  personalAvatarUser,
  projectAttachmentItem,
  projectFixtures,
} from "@workspace/mocks"
import { authClient } from "@/lib/auth-client"
import { ProjectCreate } from "./project-create"
import { ProjectEditForm } from "./project-edit"
import { ProjectAttachmentsSection } from "./project-attachments"

const org = organizations[0].id
const project = projectFixtures(org, "zh-CN")[0]!
function EditAttachments() {
  const [locale, setLocale] = useState<"zh-CN" | "en-US" | "ar">("zh-CN")
  return (
    <ProjectEditForm
      organizationId={org}
      project={project}
      targetLocale={locale}
      onTargetLocaleChange={setLocale}
      initial={{ name: "Original", description: "Summary" }}
      attachments={{ revision: 1, items: [projectAttachmentItem] }}
      onOpenChange={() => undefined}
    />
  )
}
const meta = {
  title: "Admin/Project attachments",
  component: ProjectCreate,
  args: { organizationId: org },
  decorators: [
    (Story) => (
      <AuthenticatedSessionProvider
        client={authClient}
        user={personalAvatarUser}
      >
        <Story />
      </AuthenticatedSessionProvider>
    ),
  ],
} satisfies Meta<typeof ProjectCreate>
export default meta
type Story = StoryObj<typeof meta>
const createRequests: CreateProject[] = []
const createScenario = createProjectAttachmentsScenario()
async function pickAttachment(
  body: HTMLElement,
  addLabel: string,
  pickerLabel: string,
  confirmLabel: string
) {
  const screen = within(body)
  await userEvent.click(await screen.findByRole("button", { name: addLabel }))
  const picker = within(
    await screen.findByRole("dialog", { name: pickerLabel })
  )
  await userEvent.click(
    await picker.findByRole("button", { name: "Attachment.txt" })
  )
  await userEvent.click(picker.getByRole("button", { name: confirmLabel }))
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: pickerLabel })
    ).not.toBeInTheDocument()
  )
}
export const CreateFixedReference: Story = {
  parameters: {
    msw: {
      handlers: [
        ...createScenario.handlers,
        createProjectHandler("success", (input) => createRequests.push(input)),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    createRequests.length = 0
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "创建项目" })
    )
    await userEvent.type(
      await screen.findByLabelText("项目名称"),
      "Attachment project"
    )
    await userEvent.type(screen.getByLabelText("描述"), "Pure text summary")
    await pickAttachment(
      canvasElement.ownerDocument.body,
      "添加附件",
      "选择文件",
      "使用文件"
    )
    const dialog = within(screen.getByRole("dialog", { name: "创建项目" }))
    await expect(dialog.getByText("Attachment.txt")).toBeVisible()
    await userEvent.click(dialog.getByRole("button", { name: "创建项目" }))
    await waitFor(() => expect(createRequests).toHaveLength(1))
    await expect(createRequests[0]).toMatchObject({
      description: "Pure text summary",
      attachments: [
        {
          fileId: projectAttachmentItem.fileId,
          versionId: projectAttachmentItem.versionId,
        },
      ],
    })
    await expect(createRequests[0]!.attachments![0]).not.toHaveProperty("name")
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
  },
}
const failureScenario = createProjectAttachmentsScenario()
export const FailedCreateKeepsAttachmentAndText: Story = {
  parameters: {
    msw: {
      handlers: [...failureScenario.handlers, createProjectHandler("error")],
    },
  },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "创建项目" })
    )
    await userEvent.type(
      await screen.findByLabelText("项目名称"),
      "Keep both drafts"
    )
    await pickAttachment(
      canvasElement.ownerDocument.body,
      "添加附件",
      "选择文件",
      "使用文件"
    )
    const dialog = within(screen.getByRole("dialog", { name: "创建项目" }))
    await userEvent.click(dialog.getByRole("button", { name: "创建项目" }))
    await expect(await dialog.findByRole("alert")).toHaveTextContent(
      "操作未成功"
    )
    await expect(dialog.getByLabelText("项目名称")).toHaveValue(
      "Keep both drafts"
    )
    await expect(dialog.getByText("Attachment.txt")).toBeVisible()
  },
}
const conflictScenario = createProjectAttachmentsScenario({
  items: [projectAttachmentItem],
  edit: "conflict",
})
export const ConflictRequiresExplicitRevisionRefresh: Story = {
  render: () => <EditAttachments />,
  parameters: { msw: { handlers: conflictScenario.handlers } },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body)
    const dialog = within(await screen.findByRole("dialog"))
    await userEvent.type(dialog.getByLabelText("描述"), " draft")
    await userEvent.click(dialog.getByRole("button", { name: "移除引用" }))
    await userEvent.click(dialog.getByRole("button", { name: "保存项目" }))
    await expect(await dialog.findByRole("alert")).toHaveTextContent(
      "附件已被其他人修改"
    )
    await expect(dialog.getByLabelText("描述")).toHaveValue("Summary draft")
    await waitFor(() => expect(dialog.getByText("暂无附件")).toBeVisible())
    await expect(
      dialog.getByRole("button", { name: "保存项目" })
    ).toBeDisabled()
    await userEvent.click(
      dialog.getByRole("button", { name: "刷新附件修订并保留草稿" })
    )
    await waitFor(() =>
      expect(dialog.getByRole("button", { name: "保存项目" })).toBeEnabled()
    )
    await userEvent.click(dialog.getByRole("button", { name: "保存项目" }))
    await waitFor(() => expect(conflictScenario.writes).toHaveLength(2))
    await expect(conflictScenario.writes[1]!.attachments).toEqual({
      expectedRevision: 2,
      items: [],
    })
    await expect(conflictScenario.writes[1]!.translation?.description).toBe(
      "Summary draft"
    )
  },
}
export const TranslatorReadsAttachments: Story = {
  render: () => <EditAttachments />,
  parameters: {
    msw: {
      handlers: createProjectAttachmentsScenario({
        permission: "translate",
        items: [projectAttachmentItem],
      }).handlers,
    },
  },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body)
    const dialog = within(await screen.findByRole("dialog"))
    await waitFor(() =>
      expect(dialog.getByText("翻译项目时附件只读。")).toBeVisible()
    )
    await expect(
      dialog.queryByRole("button", { name: "移除引用" })
    ).not.toBeInTheDocument()
    await expect(
      dialog.queryByRole("button", { name: "添加附件" })
    ).not.toBeInTheDocument()
    await expect(dialog.getByText("Attachment.txt")).toBeVisible()
    await expect(dialog.getByLabelText("状态")).toBeDisabled()
  },
}
export const ProjectReaderSeesMetadataWithoutFileRead: Story = {
  render: () => (
    <ProjectAttachmentsSection organizationId={org} projectId={project.id} />
  ),
  parameters: {
    msw: {
      handlers: createProjectAttachmentsScenario({
        permission: "project-only",
        items: [projectAttachmentItem],
      }).handlers,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText("Attachment.txt")).toBeVisible()
    await expect(
      await canvas.findByRole("button", { name: "预览" })
    ).toBeDisabled()
    await expect(
      canvas.getByText("读取附件内容需要文件读取权限。")
    ).toBeVisible()
  },
}
export const EnglishMetadata: Story = {
  render: () => (
    <ProjectAttachmentsSection organizationId={org} projectId={project.id} />
  ),
  globals: { locale: "en-US" },
  parameters: {
    msw: {
      handlers: createProjectAttachmentsScenario({
        items: [projectAttachmentItem],
      }).handlers,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole("heading", { name: "Attachments" })
    ).toBeVisible()
    await expect(await canvas.findByText(/Version created/)).toBeVisible()
  },
}
export const ArabicFixedVersionPreview: Story = {
  render: () => (
    <ProjectAttachmentsSection organizationId={org} projectId={project.id} />
  ),
  globals: { locale: "ar" },
  parameters: {
    msw: {
      handlers: createProjectAttachmentsScenario({
        items: [projectAttachmentItem],
      }).handlers,
    },
  },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body)
    const preview = await within(canvasElement).findByRole("button", {
      name: "معاينة",
    })
    await waitFor(() => expect(preview).toBeEnabled())
    await userEvent.click(preview)
    const sheet = await screen.findByRole("dialog")
    await waitFor(() => expect(sheet).toBeVisible())
    await expect(getComputedStyle(sheet).direction).toBe("rtl")
    await expect(
      await within(sheet).findByText("Fixed project attachment text")
    ).toBeVisible()
    await expect(
      within(sheet).getByRole("button", { name: "تنزيل الملف" })
    ).toBeEnabled()
  },
}
