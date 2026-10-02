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
      <main className="max-w-xl p-6">
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
const meta = {
  title: "Admin/Personal avatar",
  component: AvatarSettingsStory,
  globals: { locale: "en-US" },
  ...scenario(),
} satisfies Meta<typeof AvatarSettingsStory>
export default meta
type Story = StoryObj<typeof meta>
async function upload(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  const file = new File([personalAvatarImage], "draft.png", {
    type: "image/png",
  })
  await userEvent.upload(canvas.getByLabelText("Choose avatar image"), file)
  await expect(await canvas.findByAltText("Avatar draft preview")).toBeVisible()
  await expect(
    canvas.getByRole("button", { name: "Save avatar" })
  ).toBeDisabled()
  await userEvent.click(canvas.getByRole("button", { name: "Upload draft" }))
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
    const canvas = await upload(canvasElement)
    await expect(await canvas.findByRole("status")).toHaveTextContent(
      "Draft uploaded. It is not your avatar yet."
    )
    await clickAvatarButton(canvas, "Save avatar")
    await waitFor(() =>
      expect(canvas.getByRole("status")).toHaveTextContent(
        "Avatar settings saved."
      )
    )
    await expect(canvas.queryByAltText("Avatar draft preview")).toBeNull()
    await clickAvatarButton(canvas, "Remove avatar")
    await waitFor(() =>
      expect(
        canvas.getByRole("button", { name: "Remove avatar" })
      ).toBeDisabled()
    )
  },
}
export const UploadErrorKeepsDraft: Story = {
  ...scenario("upload-error"),
  play: async ({ canvasElement }) => {
    const canvas = await upload(canvasElement)
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Avatar upload failed"
    )
    await expect(canvas.getByAltText("Avatar draft preview")).toBeVisible()
    await expect(
      canvas.getByRole("button", { name: "Save avatar" })
    ).toBeDisabled()
  },
}
export const SaveConflictKeepsCurrentAndDraft: Story = {
  ...scenario("save-conflict"),
  play: async ({ canvasElement }) => {
    const canvas = await upload(canvasElement)
    await canvas.findByRole("status")
    const current = canvas.getByAltText("Avatar editor").getAttribute("src")
    await clickAvatarButton(canvas, "Save avatar")
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Avatar save failed"
    )
    await expect(canvas.getByAltText("Avatar draft preview")).toBeVisible()
    await expect(canvas.getByAltText("Avatar editor")).toHaveAttribute(
      "src",
      current!
    )
    await clickAvatarButton(canvas, "Save avatar")
    await waitFor(() =>
      expect(canvas.getByRole("status")).toHaveTextContent(
        "Avatar settings saved."
      )
    )
  },
}
export const UploadBusy: Story = {
  ...scenario("slow-upload"),
  play: async ({ canvasElement }) => {
    const canvas = await upload(canvasElement)
    await expect(
      await canvas.findByRole("button", { name: "Uploading draft…" })
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
    await expect(canvas.queryByAltText("Avatar draft preview")).toBeNull()
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
    await expect(
      await canvas.findByAltText("Avatar draft preview")
    ).toBeVisible()
  },
}
export const RTL: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole("heading", { name: "الصورة الشخصية" })
    ).toBeVisible()
    await expect(canvas.getByLabelText("اختيار صورة شخصية")).toBeVisible()
    await expect(document.documentElement).toHaveAttribute("dir", "rtl")
  },
}
export const Chinese: Story = {
  globals: { locale: "zh-CN" },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("button", {
        name: "上传草稿",
      })
    ).toBeVisible()
  },
}

const unknownSave = createPersonalAvatarScenario("save-unknown")
export const UnknownSaveExplicitRetry: Story = {
  beforeEach: unknownSave.reset,
  parameters: { msw: { handlers: unknownSave.handlers } },
  play: async ({ canvasElement }) => {
    const canvas = await upload(canvasElement)
    await canvas.findByRole("status")
    await clickAvatarButton(canvas, "Save avatar")
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "The save result was not received."
    )
    await expect(canvas.getByAltText("Avatar draft preview")).toBeVisible()
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
    const canvas = await upload(canvasElement)
    await canvas.findByRole("status")
    await clickAvatarButton(canvas, "Save avatar")
    await waitFor(() =>
      expect(canvas.getByRole("status")).toHaveTextContent(
        "Avatar settings saved."
      )
    )
    const input = canvas.getByLabelText("Choose avatar image")
    await expect(input).toBeVisible()
    await userEvent.upload(
      input,
      new File([personalAvatarImage], "replacement.png", { type: "image/png" })
    )
    await expect(
      await canvas.findByAltText("Avatar draft preview")
    ).toBeVisible()
    await expect(
      canvas.getByRole("button", { name: "Upload draft" })
    ).toBeEnabled()
  },
}
