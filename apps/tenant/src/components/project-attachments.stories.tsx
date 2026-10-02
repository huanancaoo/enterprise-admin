import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { AuthenticatedSessionProvider } from "@workspace/admin/auth"
import type { CreateProject } from "@workspace/contracts"
import {
  createProjectAttachmentsScenario,
  createProjectHandler,
  createProjectEditHandlers,
  organizations,
  personalAvatarUser,
  projectAttachmentItem,
  projectFixtures,
} from "@workspace/mocks"
import { authClient } from "@/lib/auth-client"
import { ProjectCreate } from "./project-create"
import { ProjectEdit, ProjectEditForm } from "./project-edit"
import { ProjectAttachmentsSection } from "./project-attachments"

const org = organizations[0].id
const project = projectFixtures(org, "zh-CN")[0]!
function EditAttachments() {
  return (
    <ProjectEditForm
      organizationId={org}
      project={project}
      initialLocale="zh-CN"
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
    // 附件草稿先渲染；变更入口需等待原生 project:update 授权返回。
    await userEvent.click(
      await dialog.findByRole("button", { name: "移除引用" })
    )
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

async function clickReadyOption(
  screen: ReturnType<typeof within>,
  name: string
) {
  // 关闭中的原生 Select 仍保留选项 DOM；存在不代表可接收下一次鼠标操作。
  const option = await waitFor(() => {
    const current = screen.getByRole("option", { name })
    expect(current).toBeVisible()
    expect(getComputedStyle(current).pointerEvents).not.toBe("none")
    return current
  })
  await userEvent.click(option)
}

const uiDraftScenario = createProjectAttachmentsScenario({
  items: [projectAttachmentItem],
  edit: "conflict",
})
export const UiLanguageKeepsEditSessionAndConflict: Story = {
  render: () => <ProjectEdit organizationId={org} project={project} />,
  parameters: {
    msw: {
      handlers: [...uiDraftScenario.handlers, ...createProjectEditHandlers()],
    },
  },
  play: async ({ canvasElement }) => {
    uiDraftScenario.writes.length = 0
    const screen = within(canvasElement.ownerDocument.body)
    const trigger = await within(canvasElement).findByRole("button", {
      name: "编辑项目",
    })
    await waitFor(() => expect(trigger).toBeEnabled())
    await userEvent.click(trigger)
    await screen.findByLabelText("项目名称")
    const dialog = () => within(screen.getByRole("dialog"))
    const field = (id: string) =>
      screen.getByRole("dialog").querySelector<HTMLElement>(`#${id}`)!
    const chooseContentLocale = async (locale: string) => {
      await userEvent.click(field("project-edit-content-locale"))
      await clickReadyOption(screen, locale)
    }
    await chooseContentLocale("English")
    await waitFor(() =>
      expect(dialog().getByLabelText("项目名称")).toHaveValue(
        "Original en-US content"
      )
    )
    await userEvent.clear(dialog().getByLabelText("项目名称"))
    await userEvent.type(
      dialog().getByLabelText("项目名称"),
      "Canceled English draft"
    )
    await userEvent.click(field("project-edit-status"))
    await clickReadyOption(screen, "活跃")
    await userEvent.click(
      await dialog().findByRole("button", { name: "移除引用" })
    )
    await chooseContentLocale("简体中文")
    await waitFor(() =>
      expect(dialog().getByLabelText("项目名称")).toHaveValue(
        "Original zh-CN content"
      )
    )
    await userEvent.click(dialog().getByRole("button", { name: "取消" }))
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    await expect(uiDraftScenario.writes).toHaveLength(0)
    await userEvent.click(trigger)
    await screen.findByLabelText("项目名称")
    await expect(dialog().getByLabelText("项目名称")).toHaveValue(
      "Original zh-CN content"
    )
    await expect(field("project-edit-status")).toHaveTextContent("草稿")
    await waitFor(() =>
      expect(dialog().getByText("Attachment.txt")).toBeVisible()
    )
    await chooseContentLocale("English")
    const name = await screen.findByLabelText("项目名称")
    await waitFor(() => expect(name).toHaveValue("Original en-US content"))
    await userEvent.clear(name)
    await userEvent.type(name, "English draft")
    await userEvent.type(dialog().getByLabelText("描述"), "English description")
    await userEvent.click(field("project-edit-status"))
    await clickReadyOption(screen, "活跃")
    await userEvent.click(
      await dialog().findByRole("button", { name: "移除引用" })
    )
    await userEvent.click(dialog().getByRole("combobox", { name: "语言" }))
    await clickReadyOption(screen, "العربية")
    await waitFor(() =>
      expect(
        screen.getByRole("dialog").querySelector("#project-edit-name")
      ).toHaveValue("English draft")
    )
    await expect(name).toBeInTheDocument()
    await expect(field("project-edit-content-locale")).toHaveTextContent(
      "English"
    )
    await expect(field("project-edit-status")).toHaveTextContent("نشط")
    await expect(dialog().getByText("لا توجد مرفقات")).toBeVisible()
    await userEvent.click(dialog().getByRole("combobox", { name: "اللغة" }))
    await clickReadyOption(screen, "简体中文")
    await userEvent.click(dialog().getByRole("button", { name: "保存项目" }))
    await expect(await dialog().findByRole("alert")).toHaveTextContent(
      "附件已被其他人修改"
    )
    await expect(uiDraftScenario.writes[0]).toEqual({
      status: "active",
      translation: {
        locale: "en-US",
        name: "English draft",
        description: "English description",
      },
      attachments: { expectedRevision: 1, items: [] },
    })
    await userEvent.click(dialog().getByRole("combobox", { name: "语言" }))
    await clickReadyOption(screen, "العربية")
    await waitFor(() =>
      expect(
        dialog().getByRole("button", { name: "حفظ المشروع" })
      ).toBeDisabled()
    )
    await expect(name).toHaveValue("English draft")
    await expect(dialog().getByText("لا توجد مرفقات")).toBeVisible()
    await userEvent.click(dialog().getByRole("combobox", { name: "اللغة" }))
    await clickReadyOption(screen, "简体中文")
    await expect(
      dialog().getByRole("button", { name: "保存项目" })
    ).toBeDisabled()
    await userEvent.click(
      dialog().getByRole("button", { name: "刷新附件修订并保留草稿" })
    )
    await waitFor(() =>
      expect(dialog().getByRole("button", { name: "保存项目" })).toBeEnabled()
    )
    await userEvent.click(dialog().getByRole("button", { name: "保存项目" }))
    await waitFor(() => expect(uiDraftScenario.writes).toHaveLength(2))
    await expect(uiDraftScenario.writes[1]).toEqual({
      ...uiDraftScenario.writes[0],
      attachments: { expectedRevision: 2, items: [] },
    })
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
  },
}

const contentDraftScenario = createProjectAttachmentsScenario({
  items: [projectAttachmentItem],
  edit: "success",
})
export const ContentLanguagesKeepIndependentTextAndSharedDraft: Story = {
  render: () => <ProjectEdit organizationId={org} project={project} />,
  parameters: {
    msw: {
      handlers: [
        ...contentDraftScenario.handlers,
        ...createProjectEditHandlers(),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    contentDraftScenario.writes.length = 0
    const screen = within(canvasElement.ownerDocument.body)
    const trigger = await within(canvasElement).findByRole("button", {
      name: "编辑项目",
    })
    await waitFor(() => expect(trigger).toBeEnabled())
    await userEvent.click(trigger)
    await screen.findByLabelText("项目名称")
    const dialog = () => within(screen.getByRole("dialog"))
    await dialog().findByLabelText("项目名称")
    const field = (id: string) =>
      screen.getByRole("dialog").querySelector<HTMLElement>(`#${id}`)!
    const choose = async (locale: string) => {
      await userEvent.click(field("project-edit-content-locale"))
      await clickReadyOption(screen, locale)
    }
    await userEvent.clear(dialog().getByLabelText("项目名称"))
    await userEvent.type(dialog().getByLabelText("项目名称"), "中文草稿")
    await userEvent.type(dialog().getByLabelText("描述"), "中文描述")
    await userEvent.click(field("project-edit-status"))
    await clickReadyOption(screen, "活跃")
    await userEvent.click(
      await dialog().findByRole("button", { name: "移除引用" })
    )
    await choose("English")
    await waitFor(() =>
      expect(
        screen.getByRole("dialog").querySelector("#project-edit-name")
      ).toHaveValue("Original en-US content")
    )
    await expect(field("project-edit-status")).toHaveTextContent("活跃")
    await userEvent.clear(dialog().getByLabelText("项目名称"))
    await userEvent.type(dialog().getByLabelText("项目名称"), "English draft")
    await userEvent.type(dialog().getByLabelText("描述"), "English description")
    await choose("简体中文")
    await waitFor(() =>
      expect(dialog().getByLabelText("项目名称")).toHaveValue("中文草稿")
    )
    await expect(dialog().getByLabelText("描述")).toHaveValue("中文描述")
    await expect(field("project-edit-status")).toHaveTextContent("活跃")
    await expect(dialog().getByText("暂无附件")).toBeVisible()
    await choose("العربية")
    await waitFor(() =>
      expect(dialog().getByLabelText("项目名称")).toHaveValue(
        "Original ar content"
      )
    )
    await userEvent.clear(dialog().getByLabelText("项目名称"))
    await userEvent.type(dialog().getByLabelText("项目名称"), "Arabic draft")
    await choose("English")
    await waitFor(() =>
      expect(dialog().getByLabelText("项目名称")).toHaveValue("English draft")
    )
    await expect(dialog().getByLabelText("描述")).toHaveValue(
      "English description"
    )
    await userEvent.click(dialog().getByRole("button", { name: "保存项目" }))
    await waitFor(() => expect(contentDraftScenario.writes).toHaveLength(1))
    await expect(contentDraftScenario.writes[0]).toEqual({
      status: "active",
      translation: {
        locale: "en-US",
        name: "English draft",
        description: "English description",
      },
      attachments: { expectedRevision: 1, items: [] },
    })
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
  },
}
