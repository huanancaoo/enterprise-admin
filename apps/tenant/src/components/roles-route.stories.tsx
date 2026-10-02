import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import {
  createRolesScenario,
  longRoleKey,
  type RolesScenario,
} from "@workspace/mocks"
import { delegableRolePermissions } from "@workspace/permissions"
import { RolesStory } from "./roles.story-fixture"

const scenario = (name: RolesScenario = "success") => {
  const fixture = createRolesScenario(
    name,
    Object.entries(delegableRolePermissions).flatMap(([resource, actions]) =>
      actions.map((action) => ({ resource, action }))
    )
  )
  return {
    beforeEach: fixture.reset,
    parameters: { layout: "fullscreen", msw: { handlers: fixture.handlers } },
  }
}
const meta = {
  title: "Admin/Roles",
  component: RolesStory,
  globals: { locale: "en-US" },
  ...scenario(),
} satisfies Meta<typeof RolesStory>
export default meta
type Story = StoryObj<typeof meta>

async function roleRow(canvasElement: HTMLElement, name = "project-editor") {
  const region = await within(canvasElement).findByRole("region", {
    name: "Custom roles",
  })
  return within((await within(region).findByText(name)).closest("li")!)
}
async function creation(canvasElement: HTMLElement) {
  return within(
    await within(canvasElement).findByRole("region", { name: "Create role" })
  )
}
async function filled(canvasElement: HTMLElement, name = "new-reader") {
  const content = await creation(canvasElement)
  const input = content.getByRole("textbox", { name: "Role key" })
  await userEvent.type(input, name)
  await userEvent.click(
    content.getByRole("checkbox", { name: "Projects: view" })
  )
  return {
    content,
    input,
    submit: content.getByRole("button", { name: "Create role" }),
  }
}
async function actionDialog(
  canvasElement: HTMLElement,
  kind: "update" | "delete"
) {
  const target = await roleRow(canvasElement)
  const trigger = target.getByRole("button", {
    name: kind === "update" ? "Edit permissions" : "Delete role",
  })
  trigger.focus()
  await userEvent.keyboard("{Enter}")
  const popup = await within(canvasElement.ownerDocument.body).findByRole(
    "dialog"
  )
  await waitFor(() => expect(popup).toBeVisible())
  await Promise.all(
    popup.getAnimations().map((animation) => animation.finished)
  )
  return { target, trigger, popup, content: within(popup) }
}
async function closed(popup: HTMLElement) {
  await waitFor(() => expect(popup).not.toBeInTheDocument())
}

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const target = await roleRow(canvasElement)
    await expect(target.getByText("Permissions: 2")).toBeVisible()
    await expect(
      target.getByText("Projects: view、Projects: update")
    ).toBeVisible()
    await expect(
      target.getByText("Members: 0; active invitations: 0")
    ).toBeVisible()
    await expect(
      (await roleRow(canvasElement, "empty-role")).getByText("No permissions")
    ).toBeVisible()
    const builtIn = within(
      await within(canvasElement).findByRole("region", {
        name: "Built-in roles",
      })
    )
    await expect(builtIn.getAllByText("Read only")).toHaveLength(3)
    await expect(builtIn.queryAllByRole("button")).toHaveLength(0)
  },
}
export const BuiltInPermissions: Story = {
  play: async ({ canvasElement }) => {
    const builtIn = await within(canvasElement).findByRole("region", {
      name: "Built-in roles",
    })
    const member = within(
      within(builtIn).getByText("Member", { exact: true }).closest("li")!
    )
    await expect(member.getByText(/Projects: view/)).toBeVisible()
    await expect(member.getByText(/Members: view directory/)).toBeVisible()
    await expect(member.queryByText(/Projects: update/)).toBeNull()
    await expect(member.getByText(/Files: view/)).toBeVisible()
    await expect(member.getByText(/Folders: view/)).toBeVisible()
    for (const label of filePermissionLabels.filter(
      (label) => label !== "Files: view" && label !== "Folders: view"
    ))
      await expect(member.queryByText(label, { exact: false })).toBeNull()
    for (const name of ["Owner", "Admin"]) {
      const role = within(
        within(builtIn).getByText(name, { exact: true }).closest("li")!
      )
      for (const label of filePermissionLabels)
        await expect(role.getByText(label, { exact: false })).toBeVisible()
    }
  },
}
export const AccessLoading: Story = {
  ...scenario("accessLoading"),
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole("status")
    ).toHaveTextContent("Loading…")
    await expect(within(canvasElement).queryByRole("heading")).toBeNull()
  },
}
export const Loading: Story = {
  ...scenario("loading"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("heading", { name: "Custom roles" })
    await expect(canvas.getByRole("status")).toHaveTextContent("Loading…")
  },
}
export const Empty: Story = {
  ...scenario("empty"),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByText("No custom roles have been created.")
  },
}
export const Error: Story = {
  ...scenario("unavailable"),
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole("alert")
    ).toHaveTextContent("Role directory unavailable")
  },
}
export const AccessUnavailable: Story = {
  ...scenario("accessUnavailable"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("heading", { name: "Unable to load data" })
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }))
    await roleRow(canvasElement)
  },
}
const denied: Story["play"] = async ({ canvasElement }) => {
  const canvas = within(canvasElement)
  await canvas.findByText("Access denied")
  await expect(canvas.queryByRole("textbox")).toBeNull()
  await expect(canvas.queryByText("project-editor")).toBeNull()
}
export const PermissionDenied: Story = {
  ...scenario("permissionDenied"),
  play: denied,
}
export const AccessForbidden: Story = {
  ...scenario("accessForbidden"),
  play: denied,
}
export const SessionExpired: Story = {
  ...scenario("accessUnauthorized"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("heading", { name: "Unable to load data" })
    await expect(canvas.queryByRole("textbox")).toBeNull()
    await expect(canvas.queryByText("project-editor")).toBeNull()
  },
}
export const SlowNetwork: Story = {
  ...scenario("slow"),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("status")
    await roleRow(canvasElement)
  },
}
export const LongText: Story = {
  ...scenario("longText"),
  play: async ({ canvasElement }) => {
    await roleRow(canvasElement, longRoleKey)
    const html = canvasElement.ownerDocument.documentElement
    await expect(html.scrollWidth).toBe(html.clientWidth)
  },
}
export const RTL: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("heading", {
      name: "الأدوار",
    })
    await within(canvasElement).findByText("project-editor", { exact: true })
    await expect(canvasElement.ownerDocument.documentElement).toHaveAttribute(
      "dir",
      "rtl"
    )
  },
}
export const Chinese: Story = {
  globals: { locale: "zh-CN" },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("heading", {
      name: "角色",
    })
  },
}
export const ReadOnly: Story = {
  ...scenario("readOnly"),
  play: async ({ canvasElement }) => {
    await roleRow(canvasElement)
    await expect(within(canvasElement).queryAllByRole("button")).toHaveLength(0)
    await expect(within(canvasElement).queryByRole("textbox")).toBeNull()
  },
}
export const CreateOnly: Story = {
  ...scenario("createOnly"),
  play: async ({ canvasElement }) => {
    await creation(canvasElement)
    await expect(
      (await roleRow(canvasElement)).queryAllByRole("button")
    ).toHaveLength(0)
  },
}
export const UpdateOnly: Story = {
  ...scenario("updateOnly"),
  play: async ({ canvasElement }) => {
    const target = await roleRow(canvasElement)
    await expect(
      target.getByRole("button", { name: "Edit permissions" })
    ).toBeEnabled()
    await expect(
      target.queryByRole("button", { name: "Delete role" })
    ).toBeNull()
    await expect(within(canvasElement).queryByRole("textbox")).toBeNull()
  },
}
export const DeleteOnly: Story = {
  ...scenario("deleteOnly"),
  play: async ({ canvasElement }) => {
    const target = await roleRow(canvasElement)
    await expect(
      target.getByRole("button", { name: "Delete role" })
    ).toBeEnabled()
    await expect(
      target.queryByRole("button", { name: "Edit permissions" })
    ).toBeNull()
    await expect(within(canvasElement).queryByRole("textbox")).toBeNull()
  },
}
export const CreateWithKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const { content, input, submit } = await filled(canvasElement)
    submit.focus()
    await userEvent.keyboard("{Enter}")
    await roleRow(canvasElement, "new-reader")
    await expect(input).toHaveValue("")
    await expect(
      content.getByRole("checkbox", { name: "Projects: view" })
    ).not.toBeChecked()
  },
}
export const InvalidKey: Story = {
  play: async ({ canvasElement }) => {
    const { content, input, submit } = await filled(canvasElement, "platformer")
    await userEvent.click(submit)
    await expect(input).toHaveAttribute("aria-invalid", "true")
    await expect(
      content.getByText(
        "Enter a valid role key. Reserved names and keys beginning with platform are not allowed."
      )
    ).toBeVisible()
    await expect(input).toHaveValue("platformer")
  },
}
export const BuiltInKey: Story = {
  play: async ({ canvasElement }) => {
    const { input, submit } = await filled(canvasElement, "owner")
    await userEvent.click(submit)
    await expect(input).toHaveAttribute("aria-invalid", "true")
  },
}
const creationPending: Story["play"] = async ({ canvasElement }) => {
  const { content, input, submit } = await filled(canvasElement)
  await userEvent.click(submit)
  await waitFor(() => expect(input).toBeDisabled())
  for (const checkbox of content.getAllByRole("checkbox"))
    await expect(checkbox).toHaveAttribute("aria-disabled", "true")
  await expect(content.getByRole("button", { name: "Loading…" })).toBeDisabled()
}
export const CreateSaving: Story = {
  ...scenario("createLoading"),
  play: creationPending,
}
export const CreateReadBackLock: Story = {
  ...scenario("createReadBackSlow"),
  play: async ({ canvasElement }) => {
    const { content, input, submit } = await filled(canvasElement)
    await userEvent.click(submit)
    await waitFor(() => expect(input).toBeDisabled())
    await expect(input).toHaveValue("new-reader")
    // 此场景写入 300ms、读回 700ms；等待整个提交结束，而非在默认 1s 内抢先寻找新行。
    await waitFor(
      () => {
        expect(input.closest("form")).toHaveAttribute("aria-busy", "false")
        expect(input).toBeEnabled()
        expect(input).toHaveValue("")
        expect(
          content.getByRole("checkbox", { name: "Projects: view" })
        ).not.toBeChecked()
      },
      { timeout: 2000 }
    )
    await roleRow(canvasElement, "new-reader")
  },
}
const createRetry: Story["play"] = async ({ canvasElement }) => {
  const { content, input, submit } = await filled(canvasElement)
  await userEvent.click(submit)
  await content.findByRole("alert")
  await expect(input).toHaveValue("new-reader")
  await expect(
    content.getByRole("checkbox", { name: "Projects: view" })
  ).toBeChecked()
  await waitFor(() => expect(submit).toBeEnabled())
  await userEvent.click(submit)
  await roleRow(canvasElement, "new-reader")
}
export const CreateUnavailable: Story = {
  ...scenario("createUnavailable"),
  play: createRetry,
}
export const CreateRateLimited: Story = {
  ...scenario("createRateLimited"),
  play: createRetry,
}
const createRejected: Story["play"] = async ({ canvasElement }) => {
  const { content, input, submit } = await filled(canvasElement)
  await userEvent.click(submit)
  await content.findByRole("alert")
  await expect(input).toHaveValue("new-reader")
  await expect(
    content.getByRole("checkbox", { name: "Projects: view" })
  ).toBeChecked()
  await waitFor(() => expect(submit).toBeEnabled())
}
export const CreateForbidden: Story = {
  ...scenario("createForbidden"),
  play: createRejected,
}
export const CreateSessionExpired: Story = {
  ...scenario("createUnauthorized"),
  play: createRejected,
}
export const CreateDuplicate: Story = {
  ...scenario("createDuplicate"),
  play: async ({ canvasElement }) => {
    const { content, input, submit } = await filled(
      canvasElement,
      "project-editor"
    )
    await userEvent.click(submit)
    await expect(await content.findByRole("alert")).toHaveTextContent(
      "This role key is already in use in this organization."
    )
    await expect(input).toHaveValue("project-editor")
  },
}
export const CreatePermissionDenied: Story = {
  ...scenario("createPermissionDenied"),
  play: async (context) => {
    await createRejected(context)
    const { canvasElement } = context
    await expect(
      (await creation(canvasElement)).getByRole("alert")
    ).toHaveTextContent("One or more selected permissions cannot be delegated.")
  },
}
export const RemoveUngrantablePermission: Story = {
  ...scenario("limitedDelegation"),
  play: async ({ canvasElement }) => {
    const { content } = await actionDialog(canvasElement, "update")
    const existing = content.getByRole("checkbox", { name: "Projects: update" })
    await expect(existing).toBeChecked()
    await expect(existing).not.toHaveAttribute("aria-disabled", "true")
    await userEvent.click(existing)
    await expect(existing).not.toBeChecked()
    await expect(existing).toHaveAttribute("aria-disabled", "true")
    await userEvent.click(existing)
    await expect(existing).not.toBeChecked()
  },
}
export const UpdateWithKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const { content, popup, target, trigger } = await actionDialog(
      canvasElement,
      "update"
    )
    content.getByRole("checkbox", { name: "Projects: update" }).focus()
    await userEvent.keyboard(" ")
    content.getByRole("button", { name: "Confirm update" }).focus()
    await userEvent.keyboard("{Enter}")
    await closed(popup)
    await expect(target.queryByText(/Projects: update/)).toBeNull()
    await expect(trigger).toHaveFocus()
  },
}
export const CloseWithKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const { popup, trigger } = await actionDialog(canvasElement, "update")
    await userEvent.keyboard("{Escape}")
    await closed(popup)
    await expect(trigger).toHaveFocus()
  },
}
const actionPending =
  (kind: "update" | "delete"): Story["play"] =>
  async ({ canvasElement }) => {
    const { popup, content } = await actionDialog(canvasElement, kind)
    await userEvent.click(
      content.getByRole("button", {
        name: kind === "update" ? "Confirm update" : "Confirm deletion",
      })
    )
    await expect(
      await content.findByRole("button", { name: "Submitting…" })
    ).toBeDisabled()
    await expect(content.getByRole("button", { name: "Cancel" })).toBeDisabled()
    for (const checkbox of content.queryAllByRole("checkbox")) {
      const checked = checkbox.getAttribute("aria-checked")
      checkbox.focus()
      await userEvent.keyboard(" ")
      await expect(checkbox).toHaveAttribute("aria-checked", checked)
      await userEvent.click(checkbox)
      await expect(checkbox).toHaveAttribute("aria-checked", checked)
      await expect(checkbox).toHaveAttribute("aria-disabled", "true")
    }
    await userEvent.keyboard("{Escape}")
    await expect(popup).toBeVisible()
  }
export const UpdateSaving: Story = {
  ...scenario("updateLoading"),
  play: actionPending("update"),
}
export const DeleteSaving: Story = {
  ...scenario("deleteLoading"),
  play: actionPending("delete"),
}
const actionRetry =
  (kind: "update" | "delete"): Story["play"] =>
  async ({ canvasElement }) => {
    const { popup, content, target } = await actionDialog(canvasElement, kind)
    if (kind === "update")
      await userEvent.click(
        content.getByRole("checkbox", { name: "Projects: update" })
      )
    const submit = content.getByRole("button", {
      name: kind === "update" ? "Confirm update" : "Confirm deletion",
    })
    await userEvent.click(submit)
    await content.findByRole("alert")
    await waitFor(() => expect(submit).toBeEnabled())
    if (kind === "update")
      await expect(
        content.getByRole("checkbox", { name: "Projects: update" })
      ).not.toBeChecked()
    await userEvent.click(submit)
    await closed(popup)
    if (kind === "update")
      await expect(target.queryByText(/Projects: update/)).toBeNull()
    else
      await expect(
        within(canvasElement).queryByText("project-editor", { exact: true })
      ).toBeNull()
  }
export const UpdateUnavailable: Story = {
  ...scenario("updateUnavailable"),
  play: actionRetry("update"),
}
export const UpdateRateLimited: Story = {
  ...scenario("updateRateLimited"),
  play: actionRetry("update"),
}
export const DeleteUnavailable: Story = {
  ...scenario("deleteUnavailable"),
  play: actionRetry("delete"),
}
export const DeleteRateLimited: Story = {
  ...scenario("deleteRateLimited"),
  play: actionRetry("delete"),
}
const actionRejected =
  (kind: "update" | "delete"): Story["play"] =>
  async ({ canvasElement }) => {
    const { content } = await actionDialog(canvasElement, kind)
    if (kind === "update")
      await userEvent.click(
        content.getByRole("checkbox", { name: "Projects: update" })
      )
    await userEvent.click(
      content.getByRole("button", {
        name: kind === "update" ? "Confirm update" : "Confirm deletion",
      })
    )
    await content.findByRole("alert")
    if (kind === "update")
      await expect(
        content.getByRole("checkbox", { name: "Projects: update" })
      ).not.toBeChecked()
  }
export const UpdateForbidden: Story = {
  ...scenario("updateForbidden"),
  play: actionRejected("update"),
}
export const UpdateSessionExpired: Story = {
  ...scenario("updateUnauthorized"),
  play: actionRejected("update"),
}
export const UpdatePermissionDenied: Story = {
  ...scenario("updatePermissionDenied"),
  play: actionRejected("update"),
}
export const DeleteForbidden: Story = {
  ...scenario("deleteForbidden"),
  play: actionRejected("delete"),
}
export const DeleteSessionExpired: Story = {
  ...scenario("deleteUnauthorized"),
  play: actionRejected("delete"),
}
const staleAction =
  (kind: "update" | "delete"): Story["play"] =>
  async ({ canvasElement }) => {
    const first = await actionDialog(canvasElement, kind)
    if (kind === "update")
      await userEvent.click(
        first.content.getByRole("checkbox", { name: "Projects: update" })
      )
    const submit = first.content.getByRole("button", {
      name: kind === "update" ? "Confirm update" : "Confirm deletion",
    })
    await userEvent.click(submit)
    await expect(await first.content.findByRole("alert")).toHaveTextContent(
      "The role or its references changed. Close this dialog and confirm again."
    )
    await expect(submit).toBeDisabled()
    if (kind === "update")
      await expect(
        first.content.getByRole("checkbox", { name: "Projects: update" })
      ).not.toBeChecked()
    await userEvent.click(first.content.getByRole("button", { name: "Cancel" }))
    await closed(first.popup)
    const next = await actionDialog(canvasElement, kind)
    await expect(
      next.content.getByText("Members: 2; active invitations: 1")
    ).toBeVisible()
    const confirmed = next.content.getByRole("button", {
      name: kind === "update" ? "Confirm update" : "Confirm deletion",
    })
    await expect(confirmed).toBeEnabled()
    await userEvent.click(confirmed)
    if (kind === "update") await closed(next.popup)
    else {
      await expect(await next.content.findByRole("alert")).toHaveTextContent(
        "This role is referenced by 2 members and 1 active invitations. Remove the references first."
      )
      await expect(next.popup).toBeVisible()
    }
  }
export const UpdateStale: Story = {
  ...scenario("updateStale"),
  play: staleAction("update"),
}
export const DeleteStale: Story = {
  ...scenario("deleteStale"),
  play: staleAction("delete"),
}
export const DeleteWithKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const { content, popup } = await actionDialog(canvasElement, "delete")
    content.getByRole("button", { name: "Confirm deletion" }).focus()
    await userEvent.keyboard("{Enter}")
    await closed(popup)
    await expect(
      within(canvasElement).queryByText("project-editor", { exact: true })
    ).toBeNull()
    await expect(
      within(canvasElement).getByRole("heading", { name: "Custom roles" })
    ).toHaveFocus()
  },
}
export const ReferencedRole: Story = {
  ...scenario("referenced"),
  play: async ({ canvasElement }) => {
    const { content } = await actionDialog(canvasElement, "delete")
    await expect(
      content.getByText("Members: 3; active invitations: 2")
    ).toBeVisible()
    await userEvent.click(
      content.getByRole("button", { name: "Confirm deletion" })
    )
    await expect(await content.findByRole("alert")).toHaveTextContent(
      "This role is referenced by 3 members and 2 active invitations. Remove the references first."
    )
  },
}

const filePermissionLabels = [
  "Files: view",
  "Files: upload",
  "Files: update",
  "Files: move to trash",
  "Files: restore",
  "Files: permanently delete",
  "Folders: view",
  "Folders: create",
  "Folders: update",
  "Folders: move to trash",
]

export const FilePermissionCatalog: Story = {
  play: async ({ canvasElement }) => {
    const content = await creation(canvasElement)
    for (const label of filePermissionLabels)
      await expect(content.getByRole("checkbox", { name: label })).toBeVisible()
    const existing = await roleRow(canvasElement)
    await expect(existing.getByText("Permissions: 2")).toBeVisible()
    for (const label of filePermissionLabels)
      await expect(existing.queryByText(label, { exact: false })).toBeNull()
  },
}

export const CreateFilePermissionsKeepsDraft: Story = {
  ...scenario("createUnavailable"),
  play: async ({ canvasElement }) => {
    const content = await creation(canvasElement)
    const input = content.getByRole("textbox", { name: "Role key" })
    await userEvent.type(input, "file-editor")
    const selected = ["Files: upload", "Folders: create"]
    for (const label of selected)
      await userEvent.click(content.getByRole("checkbox", { name: label }))
    const submit = content.getByRole("button", { name: "Create role" })
    await userEvent.click(submit)
    await content.findByRole("alert")
    await expect(input).toHaveValue("file-editor")
    for (const label of selected)
      await expect(content.getByRole("checkbox", { name: label })).toBeChecked()
    await waitFor(() => expect(submit).toBeEnabled())
    submit.focus()
    await userEvent.keyboard("{Enter}")
    const created = await roleRow(canvasElement, "file-editor")
    await expect(created.getByText("Permissions: 2")).toBeVisible()
    for (const label of selected)
      await expect(created.getByText(label, { exact: false })).toBeVisible()
    // 列表可先渲染读回结果，表单随后才重置角色名和权限草稿并解除提交锁。
    await waitFor(() => {
      expect(input.closest("form")).toHaveAttribute("aria-busy", "false")
      expect(input).toBeEnabled()
      expect(input).toHaveValue("")
      for (const label of selected)
        expect(content.getByRole("checkbox", { name: label })).not.toBeChecked()
    })
  },
}

export const UpdateFilePermissions: Story = {
  play: async ({ canvasElement }) => {
    const { content, popup, target, trigger } = await actionDialog(
      canvasElement,
      "update"
    )
    for (const label of ["Files: upload", "Folders: create"]) {
      const checkbox = content.getByRole("checkbox", { name: label })
      await expect(checkbox).not.toBeChecked()
      checkbox.focus()
      await userEvent.keyboard(" ")
    }
    content.getByRole("button", { name: "Confirm update" }).focus()
    await userEvent.keyboard("{Enter}")
    await closed(popup)
    await expect(target.getByText("Permissions: 4")).toBeVisible()
    await expect(target.getByText(/Files: upload/)).toBeVisible()
    await expect(target.getByText(/Folders: create/)).toBeVisible()
    await expect(trigger).toHaveFocus()
  },
}

export const FilePermissionsLimitedDelegation: Story = {
  ...scenario("limitedDelegation"),
  play: async ({ canvasElement }) => {
    const content = await creation(canvasElement)
    await expect(
      content.queryByRole("checkbox", { name: "Files: update" })
    ).toBeNull()
    await expect(
      content.queryByRole("checkbox", { name: "Folders: update" })
    ).toBeNull()
    await expect(
      content.getByRole("checkbox", { name: "Files: upload" })
    ).toBeEnabled()
    await expect(
      content.getByRole("checkbox", { name: "Folders: create" })
    ).toBeEnabled()
  },
}

export const ChineseFilePermissions: Story = {
  globals: { locale: "zh-CN" },
  play: async ({ canvasElement }) => {
    const content = within(
      await within(canvasElement).findByRole("region", { name: "创建角色" })
    )
    for (const label of [
      "文件：查看",
      "文件：上传",
      "文件：修改",
      "文件：移入回收站",
      "文件：恢复",
      "文件：永久删除",
      "文件夹：查看",
      "文件夹：创建",
      "文件夹：修改",
      "文件夹：移入回收站",
    ])
      await expect(content.getByRole("checkbox", { name: label })).toBeVisible()
  },
}

export const ArabicFilePermissions: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    const content = within(
      await within(canvasElement).findByRole("region", { name: "إنشاء دور" })
    )
    for (const label of [
      "الملفات: عرض",
      "الملفات: تحميل",
      "الملفات: تعديل",
      "الملفات: نقل إلى سلة المحذوفات",
      "الملفات: استعادة",
      "الملفات: حذف نهائي",
      "المجلدات: عرض",
      "المجلدات: إنشاء",
      "المجلدات: تعديل",
      "المجلدات: نقل إلى سلة المحذوفات",
    ])
      await expect(content.getByRole("checkbox", { name: label })).toBeVisible()
    await expect(canvasElement.ownerDocument.documentElement).toHaveAttribute(
      "dir",
      "rtl"
    )
  },
}
