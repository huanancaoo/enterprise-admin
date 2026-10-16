import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { PersonalAvatarSettings } from "@workspace/admin"
import {
  AuthenticatedSessionProvider,
  createWorkspaceAuthClient,
} from "@workspace/admin/auth"
import {
  createPersonalAvatarScenario,
  personalAvatarImage,
  type PersonalAvatarScenario,
} from "@workspace/mocks"

function AvatarSettingsStory() {
  const [client] = useState(createWorkspaceAuthClient)
  const session = client.useSession()
  const fallback = createPersonalAvatarScenario().user
  return (
    <AuthenticatedSessionProvider
      client={client}
      user={session.data?.user ?? fallback}
    >
      <main className="max-w-4xl p-6">
        <PersonalAvatarSettings client={client} />
      </main>
    </AuthenticatedSessionProvider>
  )
}
function scenario(name: PersonalAvatarScenario = "success") {
  const fixture = createPersonalAvatarScenario(name)
  return {
    beforeEach: fixture.reset,
    parameters: { msw: { handlers: fixture.handlers } },
  }
}
const successScenario = createPersonalAvatarScenario()
const meta = {
  title: "Admin/Personal avatar",
  component: AvatarSettingsStory,
  globals: { locale: "en-US" },
  beforeEach: successScenario.reset,
  parameters: { msw: { handlers: successScenario.handlers } },
} satisfies Meta<typeof AvatarSettingsStory>
export default meta
type Story = StoryObj<typeof meta>
async function selectAvatar(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  const file = new File([personalAvatarImage], "avatar.png", {
    type: "image/png",
  })
  await userEvent.upload(canvas.getByLabelText("Choose avatar image"), file)
  await expect(await canvas.findByAltText("New avatar preview")).toBeVisible()
  await expect(
    canvas.getByRole("button", { name: "Save avatar" })
  ).toBeEnabled()
  return canvas
}
async function clickAvatarButton(
  canvas: ReturnType<typeof within>,
  name: string
) {
  // 错误提示可能先于会话读回结束出现；下一次明确操作要等按钮恢复可用。
  await waitFor(() =>
    expect(canvas.getByRole("button", { name })).toBeEnabled()
  )
  await userEvent.click(canvas.getByRole("button", { name }))
}
export const SaveAndRemove: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await selectAvatar(canvasElement)
    await clickAvatarButton(canvas, "Save avatar")
    await waitFor(() =>
      expect(canvas.getByRole("status")).toHaveTextContent(
        "Avatar settings saved."
      )
    )
    await expect(successScenario.snapshot().uploads).toHaveLength(1)
    await expect(successScenario.snapshot().saves).toHaveLength(1)
    await expect(canvas.queryByAltText("New avatar preview")).toBeNull()
    await clickAvatarButton(canvas, "Remove avatar")
    await waitFor(() =>
      expect(
        canvas.getByRole("button", { name: "Remove avatar" })
      ).toBeDisabled()
    )
  },
}
const uploadFailure = createPersonalAvatarScenario("upload-error")
export const UploadErrorKeepsSelection: Story = {
  beforeEach: uploadFailure.reset,
  parameters: { msw: { handlers: uploadFailure.handlers } },
  play: async ({ canvasElement }) => {
    const canvas = await selectAvatar(canvasElement)
    await clickAvatarButton(canvas, "Save avatar")
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Avatar save failed"
    )
    await expect(canvas.getByAltText("New avatar preview")).toBeVisible()
    await expect(
      canvas.getByRole("button", { name: "Save avatar" })
    ).toBeEnabled()
    await clickAvatarButton(canvas, "Save avatar")
    await waitFor(() =>
      expect(canvas.getByRole("status")).toHaveTextContent(
        "Avatar settings saved."
      )
    )
    await expect(uploadFailure.snapshot().uploads).toHaveLength(1)
    await expect(uploadFailure.snapshot().saves).toHaveLength(1)
  },
}
const createConflict = createPersonalAvatarScenario("save-conflict")
export const SaveConflictKeepsCurrentAndSelection: Story = {
  beforeEach: createConflict.reset,
  parameters: { msw: { handlers: createConflict.handlers } },
  play: async ({ canvasElement }) => {
    const current = createConflict.snapshot().image
    const canvas = await selectAvatar(canvasElement)
    await clickAvatarButton(canvas, "Save avatar")
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Avatar save failed"
    )
    await expect(canvas.getByAltText("New avatar preview")).toBeVisible()
    await expect(createConflict.snapshot().image).toBe(current)
    await clickAvatarButton(canvas, "Save avatar")
    await waitFor(() =>
      expect(canvas.getByRole("status")).toHaveTextContent(
        "Avatar settings saved."
      )
    )
    await expect(createConflict.snapshot().uploads).toHaveLength(1)
    await expect(createConflict.snapshot().saves).toHaveLength(2)
  },
}
export const UploadBusy: Story = {
  ...scenario("slow-upload"),
  play: async ({ canvasElement }) => {
    const canvas = await selectAvatar(canvasElement)
    await clickAvatarButton(canvas, "Save avatar")
    await expect(
      await canvas.findByRole("button", { name: "Saving avatar…" })
    ).toBeDisabled()
    await expect(canvas.getByLabelText("Choose avatar image")).toBeDisabled()
  },
}
export const InvalidAndTooLarge: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByLabelText("Choose avatar image")
    await userEvent
      .setup({ applyAccept: false })
      .upload(
        input,
        new File(["<svg></svg>"], "unsafe.svg", { type: "image/svg+xml" })
      )
    await expect(
      await canvas.findByText(
        "Choose a decodable JPEG, PNG, WebP or GIF image."
      )
    ).toBeVisible()
    await expect(canvas.queryByAltText("New avatar preview")).toBeNull()
    await userEvent.upload(
      input,
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", {
        type: "image/png",
      })
    )
    await expect(
      await canvas.findByText("The avatar image must be at most 5 MiB.")
    ).toBeVisible()
    await userEvent.upload(
      input,
      new File([personalAvatarImage], "valid.png", { type: "image/png" })
    )
    await waitFor(() =>
      expect(
        canvas.queryByText("The avatar image must be at most 5 MiB.")
      ).toBeNull()
    )
    await expect(await canvas.findByAltText("New avatar preview")).toBeVisible()
  },
}
export const RTL: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole("heading", { name: "الصورة الشخصية" })
    ).toBeVisible()
    await expect(canvas.getByLabelText("اختيار صورة شخصية")).toBeInTheDocument()
    await expect(
      canvas.getByRole("button", { name: "اختيار صورة" })
    ).toBeVisible()
    await expect(document.documentElement).toHaveAttribute("dir", "rtl")
  },
}
export const Chinese: Story = {
  globals: { locale: "zh-CN" },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("button", {
        name: "保存头像",
      })
    ).toBeVisible()
  },
}

const unknownSave = createPersonalAvatarScenario("save-unknown")
export const UnknownSaveExplicitRetry: Story = {
  beforeEach: unknownSave.reset,
  parameters: { msw: { handlers: unknownSave.handlers } },
  play: async ({ canvasElement }) => {
    const canvas = await selectAvatar(canvasElement)
    await clickAvatarButton(canvas, "Save avatar")
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "The save result was not received."
    )
    await expect(canvas.getByAltText("New avatar preview")).toBeVisible()
    await expect(unknownSave.snapshot().uploads).toHaveLength(1)
    await expect(unknownSave.snapshot().saves).toHaveLength(1)
    await clickAvatarButton(canvas, "Save avatar")
    await waitFor(() =>
      expect(canvas.getByRole("status")).toHaveTextContent(
        "Avatar settings saved."
      )
    )
    const requests = unknownSave.snapshot().saves
    await expect(requests).toHaveLength(2)
    await expect(requests[1]).toEqual(requests[0])
  },
}

export const SaveThenChooseAgain: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await selectAvatar(canvasElement)
    await clickAvatarButton(canvas, "Save avatar")
    await waitFor(() =>
      expect(canvas.getByRole("status")).toHaveTextContent(
        "Avatar settings saved."
      )
    )
    const input = canvas.getByLabelText("Choose avatar image")
    await expect(input).toBeInTheDocument()
    await expect(
      canvas.getByRole("button", { name: "Choose image" })
    ).toBeVisible()
    await userEvent.upload(
      input,
      new File([personalAvatarImage], "replacement.png", { type: "image/png" })
    )
    await expect(await canvas.findByAltText("New avatar preview")).toBeVisible()
    await expect(
      canvas.getByRole("button", { name: "Save avatar" })
    ).toBeEnabled()
  },
}

export const SelectedPreview: Story = {
  globals: { locale: "zh-CN" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.upload(
      canvas.getByLabelText("选择头像图片"),
      new File([personalAvatarImage], "avatar.png", { type: "image/png" })
    )
    await expect(await canvas.findByAltText("新头像预览")).toBeVisible()
    await expect(canvas.getByText("保存后生效")).toBeVisible()
    await expect(canvas.getByRole("button", { name: "保存头像" })).toBeEnabled()
    await expect(canvas.queryByAltText("Avatar editor")).toBeNull()
  },
}
