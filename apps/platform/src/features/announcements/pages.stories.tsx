import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  AnnouncementArticle,
  AnnouncementInbox,
} from "@workspace/announcements"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import {
  AnnouncementEditor,
  type AnnouncementDraftValue,
} from "./announcement-editor"
import { AnnouncementList } from "./announcement-list"

const summary = {
  id: "announcement-draft",
  title: "Scheduled system maintenance",
  type: "notice" as const,
  status: "draft" as const,
  audience: "platform" as const,
  version: 1,
  publicationId: null,
  publishedAt: null,
  createdAt: "2026-10-17T10:00:00.000Z",
  updatedAt: "2026-10-17T10:00:00.000Z",
  authorName: "Platform administrator",
}
const reading = {
  ...summary,
  status: "published" as const,
  publicationId: "batch-1",
  publishedAt: "2026-10-17T10:00:00.000Z",
  unread: true,
}
const initialValue: AnnouncementDraftValue = {
  title: "系统维护通知",
  type: "notice",
  content: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "维护时间为本周六 22:00–23:00。" }],
      },
    ],
  },
  attachments: [],
}
const ports = {
  contentScopeKey: "announcement-story",
  resolveImage: fn(),
  downloadFile: fn(),
  getFileErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}
const meta = {
  title: "Platform/System/Announcements",
  component: AnnouncementList,
  parameters: { layout: "padded" },
  globals: { locale: "en-US" },
  args: {
    items: [
      summary,
      {
        ...reading,
        id: "announcement-published",
        title: "New account settings",
      },
    ],
    total: 2,
    search: { page: 1, pageSize: 20 },
    status: "ready",
    onSearchChange: fn(),
    onRetry: fn(),
    onCreate: fn(),
    onEdit: fn(),
    onView: fn(),
    onReaders: fn(),
    onPublish: fn(),
    onWithdraw: fn(),
    onDelete: fn(),
    renderOrganizations: () => null,
    permissions: [
      "platform.announcement:create",
      "platform.announcement:update",
      "platform.announcement:publish",
      "platform.announcement:delete",
      "platform.announcement:readers",
    ],
  },
} satisfies Meta<typeof AnnouncementList>
export default meta
type Story = StoryObj<typeof meta>
export const List: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole("combobox", { name: "Status" })
    ).toHaveTextContent("All statuses")
    await expect(
      canvas.getByRole("combobox", { name: "Type" })
    ).toHaveTextContent("All types")
  },
}
export const Empty: Story = { args: { items: [], total: 0 } }
export const Loading: Story = {
  args: { items: [], total: 0, status: "loading" },
}
export const ReadOnly: Story = {
  args: { permissions: ["platform.announcement:readers"] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.queryByRole("button", { name: "New announcement" })
    ).toBeNull()
    await expect(
      canvas.getByRole("button", { name: "Readership" })
    ).toBeVisible()
  },
}
export const Publish: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Publish" })
    )
    const screen = within(canvasElement.ownerDocument.body)
    const dialog = within(
      await screen.findByRole("dialog", { name: "Publish announcement" })
    )
    await expect(
      dialog.getByRole("combobox", { name: "Recipients" })
    ).toHaveTextContent("Platform employees")
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }))
    await expect(args.onPublish).toHaveBeenCalledWith(
      "announcement-draft",
      { target: "platform", organizationIds: [] },
      1
    )
  },
}
export const Chinese: Story = {
  globals: { locale: "zh-CN" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole("combobox", { name: "状态" })
    ).toHaveTextContent("全部状态")
    await expect(
      canvas.getByRole("combobox", { name: "公告类型" })
    ).toHaveTextContent("全部类型")
  },
}
export const Arabic: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole("combobox", { name: "الحالة" })
    ).toHaveTextContent("جميع الحالات")
    await expect(
      canvas.getByRole("combobox", { name: "النوع" })
    ).toHaveTextContent("جميع الأنواع")
  },
}
export const Inbox: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("combobox", { name: "Status" })
    ).toHaveTextContent("All read states")
  },
  render: () => (
    <AnnouncementInbox
      items={[reading]}
      total={1}
      search={{ page: 1, pageSize: 20 }}
      status="ready"
      onSearchChange={fn()}
      onOpen={fn()}
      onRetry={fn()}
    />
  ),
}
export const Article: Story = {
  render: () => (
    <AnnouncementArticle
      item={{ ...reading, ...initialValue }}
      unread={false}
      ports={ports}
      onBack={fn()}
    />
  ),
}
export const Editor: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("combobox", { name: "Type" })
    ).toHaveTextContent("Notice")
  },
  render: () => (
    <AnnouncementEditor
      mode="edit"
      initialValue={initialValue}
      ports={ports}
      onSave={fn()}
      onBack={fn()}
      onUploadImage={fn()}
      onUploadAttachment={fn()}
    />
  ),
}

export const CancelAttachmentSelection: Story = {
  render: () => (
    <AnnouncementEditor
      mode="create"
      initialValue={initialValue}
      ports={ports}
      onPickAttachment={async () => null}
      onSave={fn()}
      onBack={fn()}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const choose = canvas.getByRole("button", {
      name: "Choose attachment from platform files",
    })
    await userEvent.click(choose)
    await waitFor(() => expect(choose).toHaveFocus())
    await expect(canvas.getByRole("textbox", { name: "Title" })).toBeVisible()
    await expect(canvas.getByRole("textbox", { name: "Title" })).toHaveValue(
      initialValue.title
    )
    await userEvent.click(choose)
    await waitFor(() => expect(choose).toHaveFocus())
  },
}

const saveDraft = fn(async () => {})
export const CreateValidation: Story = {
  render: () => (
    <AnnouncementEditor
      mode="create"
      initialValue={{
        title: "",
        type: "notice",
        content: { type: "doc", content: [{ type: "paragraph" }] },
        attachments: [],
      }}
      ports={ports}
      onSave={saveDraft}
      onBack={fn()}
      onUploadImage={fn()}
      onUploadAttachment={fn()}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Save draft" }))
    await canvas.findByText(
      "Enter an announcement title of up to 200 characters."
    )
    await expect(saveDraft).not.toHaveBeenCalled()
    const title = canvas.getByRole("textbox", { name: "Title" })
    await expect(title).toHaveAttribute("aria-invalid", "true")
    await userEvent.type(title, "Draft maintenance notice")
    await userEvent.click(canvas.getByRole("button", { name: "Save draft" }))
    await waitFor(() =>
      expect(saveDraft).toHaveBeenCalledWith({
        title: "Draft maintenance notice",
        type: "notice",
        content: { type: "doc", content: [{ type: "paragraph" }] },
        attachments: [],
      })
    )
  },
}

export const WithdrawAfterCancelledPublish: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole("button", { name: "Publish" }))
    await userEvent.click(
      await screen.findByRole("combobox", { name: "Recipients" })
    )
    await userEvent.click(
      await screen.findByRole("option", { name: "Selected organizations" })
    )
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }))
    await screen.findByText("Select at least one organization.")
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
    await userEvent.click(
      await canvas.findByRole("button", { name: "Withdraw" })
    )
    await screen.findByRole("dialog", { name: "Withdraw announcement" })
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }))
    await waitFor(() =>
      expect(args.onWithdraw).toHaveBeenCalledWith("announcement-published", 1)
    )
  },
}
