import { useState } from "react"
import { useTranslation } from "react-i18next"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router"
import { AuthGate, AuthenticatedSessionProvider } from "@workspace/admin/auth"
import { PlatformOrganizationQuerySchema } from "@workspace/contracts"
import {
  createPlatformOrganizationScenario,
  createWorkspaceSessionHandlers,
  platformOrganizationActor,
  platformOrganizationFixture,
  type PlatformOrganizationsScenario,
} from "@workspace/mocks"
import { PlatformAccessDeniedPage, PlatformLoginPage } from "../../App"
import { authClient } from "../../lib/auth-client"
import {
  PlatformOrganizationsPage,
  PlatformOrganizationDetailPage,
} from "./pages"

function StoryLogin() {
  const { t } = useTranslation("auth")
  return (
    <AuthGate client={authClient} restoreTitle={t("platformTitle")}>
      {() => <PlatformLoginPage />}
    </AuthGate>
  )
}

function OrganizationsStory({
  detail = false,
  auditor = false,
}: {
  detail?: boolean
  auditor?: boolean
}) {
  const [router] = useState(() => {
    const root = createRootRoute()
    const platform = createRoute({
      getParentRoute: () => root,
      path: "platform",
      beforeLoad: () => ({
        platformAccess: {
          userId: platformOrganizationActor.id,
          role: auditor ? "platform_auditor" : "platform_admin",
          scope: "global",
          mfaVerifiedAt: "2026-10-02T00:00:00.000Z",
        },
      }),
      component: Outlet,
    })
    const list = createRoute({
      getParentRoute: () => platform,
      path: "organizations",
      validateSearch: (search) => PlatformOrganizationQuerySchema.parse(search),
      component: () => (
        <main className="mx-auto max-w-6xl p-6">
          <PlatformOrganizationsPage />
        </main>
      ),
    })
    const organization = createRoute({
      getParentRoute: () => platform,
      path: "organizations/$organizationId",
      component: () => (
        <main className="mx-auto max-w-6xl p-6">
          <PlatformOrganizationDetailPage />
        </main>
      ),
    })
    const denied = createRoute({
      getParentRoute: () => platform,
      path: "access-denied",
      component: PlatformAccessDeniedPage,
    })
    const login = createRoute({
      getParentRoute: () => root,
      path: "login",
      component: StoryLogin,
    })
    return createRouter({
      routeTree: root.addChildren([
        platform.addChildren([list, organization, denied]),
        login,
      ]),
      history: createMemoryHistory({
        initialEntries: [
          detail
            ? `/platform/organizations/${platformOrganizationFixture.id}`
            : "/platform/organizations",
        ],
      }),
    })
  })
  // 身份/平台任职是 UI fixture；错误跳转、查询、确认和缓存读回使用正式页面。
  return (
    <AuthenticatedSessionProvider
      client={authClient}
      user={platformOrganizationActor}
    >
      <RouterProvider router={router} />
    </AuthenticatedSessionProvider>
  )
}

const scenario = (name: PlatformOrganizationsScenario = "success") => {
  const fixture = createPlatformOrganizationScenario(name)
  return {
    beforeEach: fixture.reset,
    parameters: {
      layout: "fullscreen",
      msw: {
        handlers: [...fixture.handlers, ...createWorkspaceSessionHandlers()],
      },
    },
  }
}
const meta = {
  title: "Platform/Organizations",
  component: OrganizationsStory,
  globals: { locale: "zh-CN" },
  ...scenario(),
} satisfies Meta<typeof OrganizationsStory>
export default meta
type Story = StoryObj<typeof meta>

const loadingPlay: Story["play"] = async ({ canvasElement }) => {
  await expect(
    await within(canvasElement).findByRole("status")
  ).toHaveAttribute("aria-busy", "true")
}
const errorPlay: Story["play"] = async ({ canvasElement }) => {
  const canvas = within(canvasElement)
  await canvas.findByRole("alert")
  await expect(canvas.getByRole("button", { name: "重试" })).toBeVisible()
}
const detailPlay: Story["play"] = async ({ canvasElement }) => {
  await within(canvasElement).findByRole("heading", { name: "North workspace" })
}

export const Default: Story = {
  globals: { locale: "en-US" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole("link", { name: "North workspace" })
    )
    await canvas.findByRole("heading", { name: "North workspace" })
    await expect(
      canvas.getByRole("heading", { name: "Member overview" })
    ).toBeVisible()
    await expect(
      canvas.getByRole("heading", { name: "Status history" })
    ).toBeVisible()
    await userEvent.click(canvas.getByRole("link", { name: "Organizations" }))
    await canvas.findByRole("link", { name: "North workspace" })
  },
}
export const Loading: Story = {
  ...scenario("loading"),
  play: loadingPlay,
}
export const Empty: Story = {
  ...scenario("empty"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("heading", { name: "暂无数据" })
    await expect(canvas.queryByRole("table")).toBeNull()
  },
}
export const Error: Story = {
  ...scenario("unavailable"),
  play: errorPlay,
}
export const PermissionDenied: Story = {
  globals: { locale: "en-US" },
  ...scenario("forbidden"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("heading", { name: "Platform access denied" })
    await expect(canvas.queryByRole("table")).toBeNull()
  },
}
export const SessionExpired: Story = {
  globals: { locale: "en-US" },
  ...scenario("unauthorized"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("heading", { name: "Sign in" })
    await expect(canvas.getByText("Platform administration")).toBeVisible()
    await expect(canvas.getByRole("textbox", { name: "Email" })).toBeVisible()
    await expect(canvas.queryByRole("table")).toBeNull()
  },
}
export const LongText: Story = {
  ...scenario("longText"),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("link", {
      name: /国际研发与合规协作组织/,
    })
  },
}
export const RTL: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("link", { name: "North workspace" })
    await expect(
      canvas.getByRole("heading", { name: "المنظمات" })
    ).toBeVisible()
    await expect(canvasElement.ownerDocument.documentElement).toHaveAttribute(
      "dir",
      "rtl"
    )
  },
}
export const SlowNetwork: Story = {
  globals: { locale: "en-US" },
  ...scenario("slow"),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("link", { name: "North workspace" })
  },
}
export const Detail: Story = { args: { detail: true }, play: detailPlay }
export const DetailLoading: Story = {
  args: { detail: true },
  ...scenario("loading"),
  play: loadingPlay,
}
// 组织必须有 owner；详情的空状态是尚无状态历史，不伪造无成员组织。
export const DetailEmptyHistory: Story = {
  args: { detail: true },
  ...scenario("emptyHistory"),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByText("尚无状态转换记录。")
  },
}
export const DetailError: Story = {
  args: { detail: true },
  ...scenario("unavailable"),
  play: errorPlay,
}
export const DetailPermissionDenied: Story = {
  ...PermissionDenied,
  args: { detail: true },
}
export const DetailNotFound: Story = {
  args: { detail: true },
  ...scenario("notFound"),
  play: errorPlay,
}
export const DetailLongText: Story = {
  args: { detail: true },
  ...scenario("longText"),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("heading", {
      name: /国际研发与合规协作组织/,
    })
  },
}
export const DetailRTL: Story = {
  args: { detail: true },
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("heading", {
      name: "North workspace",
    })
    await expect(canvasElement.ownerDocument.documentElement).toHaveAttribute(
      "dir",
      "rtl"
    )
  },
}
export const ReadOnly: Story = {
  args: { detail: true, auditor: true },
  globals: { locale: "en-US" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("heading", { name: "North workspace" })
    await expect(
      canvas.queryByRole("button", { name: "Suspend organization" })
    ).toBeNull()
    await expect(
      canvas.getByRole("heading", { name: "Member overview" })
    ).toBeVisible()
  },
}

async function fillConfirmation(canvasElement: HTMLElement, resume = false) {
  const canvas = within(canvasElement)
  const screen = within(canvasElement.ownerDocument.body)
  await userEvent.click(
    await canvas.findByRole("button", {
      name: resume ? "Resume organization" : "Suspend organization",
    })
  )
  const dialog = within(await screen.findByRole("alertdialog"))
  const reason = dialog.getByRole("textbox", { name: "Reason" })
  const slug = dialog.getByRole("textbox", {
    name: "Organization slug",
  })
  await userEvent.type(reason, "Review workspace safety before changing status")
  await userEvent.type(slug, platformOrganizationFixture.slug)
  const confirm = dialog.getByRole("button", {
    name: resume ? "Confirm restoration" : "Confirm suspension",
  })
  return { canvas, screen, dialog, reason, slug, confirm }
}
async function expectClosed(screen: ReturnType<typeof within>) {
  await waitFor(() =>
    expect(
      screen.queryByRole("alertdialog", { hidden: true })
    ).not.toBeInTheDocument()
  )
}
export const SuspendWithKeyboard: Story = {
  args: { detail: true },
  globals: { locale: "en-US" },
  play: async ({ canvasElement }) => {
    const { canvas, screen, dialog, reason, confirm } =
      await fillConfirmation(canvasElement)
    confirm.focus()
    await userEvent.keyboard("{Enter}")
    await expect(reason).toBeDisabled()
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled()
    await waitFor(() =>
      expect(canvas.getByRole("status")).toHaveTextContent(
        "Organization suspended."
      )
    )
    await expectClosed(screen)
    await expect(
      canvas.getByRole("button", { name: "Resume organization" })
    ).toHaveFocus()
    await userEvent.click(canvas.getByRole("link", { name: "Organizations" }))
    await waitFor(() =>
      expect(
        canvas.getByRole("row", { name: /North workspace/ })
      ).toHaveTextContent("Suspended")
    )
  },
}
export const ResumeWithKeyboard: Story = {
  args: { detail: true },
  globals: { locale: "en-US" },
  ...scenario("suspended"),
  play: async ({ canvasElement }) => {
    const { canvas, screen, confirm } = await fillConfirmation(
      canvasElement,
      true
    )
    confirm.focus()
    await userEvent.keyboard("{Enter}")
    await waitFor(() =>
      expect(canvas.getByRole("status")).toHaveTextContent(
        "Organization resumed."
      )
    )
    await expectClosed(screen)
    await expect(
      canvas.getByRole("button", { name: "Suspend organization" })
    ).toHaveFocus()
  },
}
export const ValidationError: Story = {
  args: { detail: true },
  globals: { locale: "en-US" },
  play: async ({ canvasElement }) => {
    const { dialog, reason, slug, confirm } =
      await fillConfirmation(canvasElement)
    await userEvent.clear(reason)
    await userEvent.type(reason, "short")
    await userEvent.clear(slug)
    await userEvent.type(slug, "wrong-target")
    await userEvent.click(confirm)
    await dialog.findByText("Enter a reason with 10–500 characters.")
    await expect(
      dialog.getByText("Enter the exact target organization slug.")
    ).toBeVisible()
    await expect(reason).toHaveValue("short")
    await expect(slug).toHaveValue("wrong-target")
  },
}
export const StaleVersion: Story = {
  args: { detail: true },
  globals: { locale: "en-US" },
  ...scenario("stale"),
  play: async ({ canvasElement }) => {
    const { canvas, screen, dialog, reason, slug, confirm } =
      await fillConfirmation(canvasElement)
    await userEvent.click(confirm)
    await dialog.findByRole("alert")
    await expect(reason).toHaveValue(
      "Review workspace safety before changing status"
    )
    await expect(slug).toHaveValue(platformOrganizationFixture.slug)
    await expect(confirm).toBeDisabled()
    const review = dialog.getByRole("button", {
      name: "Review and confirm the latest state",
    })
    await waitFor(() => expect(review).toBeEnabled())
    await expect(
      dialog.getByText(
        "Latest status: Suspended, version 4. Review it before confirming again."
      )
    ).toBeVisible()
    await userEvent.click(review)
    await userEvent.click(confirm)
    await waitFor(() =>
      expect(canvas.getByRole("status")).toHaveTextContent(
        "The organization is already in the target state. No change was made."
      )
    )
    await expectClosed(screen)
    await expect(
      canvas.getByRole("button", { name: "Resume organization" })
    ).toBeVisible()
  },
}
export const RateLimited: Story = {
  args: { detail: true },
  globals: { locale: "en-US" },
  ...scenario("rateLimited"),
  play: async ({ canvasElement }) => {
    const { canvas, screen, dialog, reason, confirm } =
      await fillConfirmation(canvasElement)
    await userEvent.click(confirm)
    await dialog.findByRole("alert")
    await expect(reason).toHaveValue(
      "Review workspace safety before changing status"
    )
    await expect(confirm).toBeEnabled()
    await userEvent.click(confirm)
    await waitFor(() =>
      expect(canvas.getByRole("status")).toHaveTextContent(
        "Organization suspended."
      )
    )
    await expectClosed(screen)
  },
}
export const RecentMfaRequired: Story = {
  args: { detail: true },
  globals: { locale: "en-US" },
  ...scenario("mfaRequired"),
  play: async ({ canvasElement }) => {
    const { canvas, screen, dialog, reason, confirm } =
      await fillConfirmation(canvasElement)
    await userEvent.click(confirm)
    const code = await dialog.findByRole("textbox", { name: "Six-digit code" })
    await expect(reason).toHaveValue(
      "Review workspace safety before changing status"
    )
    await userEvent.type(code, "123456")
    await userEvent.click(
      dialog.getByRole("button", { name: "Verify and retry" })
    )
    await waitFor(() =>
      expect(canvas.getByRole("status")).toHaveTextContent(
        "Organization suspended."
      )
    )
    await expectClosed(screen)
  },
}

export const FilterAndPagination: Story = {
  globals: { locale: "en-US" },
  ...scenario("paginated"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    await canvas.findByRole("table")
    await userEvent.click(canvas.getByRole("combobox", { name: "Sort by" }))
    await userEvent.click(
      await screen.findByRole("option", { name: "Members" })
    )
    await userEvent.click(
      canvas.getByRole("combobox", { name: "Sort direction" })
    )
    await userEvent.click(
      await screen.findByRole("option", { name: "Ascending" })
    )
    await userEvent.click(canvas.getByRole("button", { name: "Apply filters" }))
    await canvas.findByRole("link", { name: "South workspace" })
    await expect(canvas.getAllByRole("row")).toHaveLength(21)
    await userEvent.click(canvas.getByRole("button", { name: "Next page" }))
    await waitFor(() => expect(canvas.getAllByRole("row")).toHaveLength(6))
    await expect(
      canvas.getByRole("link", { name: "North workspace" })
    ).toBeVisible()

    await userEvent.type(
      canvas.getByRole("textbox", { name: "Search name or slug" }),
      "operations-workspace-25"
    )
    await userEvent.click(canvas.getByRole("button", { name: "Apply filters" }))
    await canvas.findByRole("link", { name: "Operations workspace 25" })
    await expect(canvas.getAllByRole("row")).toHaveLength(2)
    await expect(
      canvas.queryByRole("link", { name: "North workspace" })
    ).toBeNull()

    await userEvent.clear(
      canvas.getByRole("textbox", { name: "Search name or slug" })
    )
    await userEvent.click(
      canvas.getByRole("combobox", { name: "Organization status" })
    )
    await userEvent.click(await screen.findByRole("option", { name: "Active" }))
    await userEvent.click(canvas.getByRole("button", { name: "Apply filters" }))
    await canvas.findByRole("link", { name: "North workspace" })
    await expect(canvas.getAllByRole("row")).toHaveLength(2)
    await expect(
      canvas.queryByRole("link", { name: "Operations workspace 25" })
    ).toBeNull()
  },
}

export const SuspendRTL: Story = {
  args: { detail: true },
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      await canvas.findByRole("button", { name: "إيقاف المنظمة" })
    )
    const dialog = within(await screen.findByRole("alertdialog"))
    const reason = dialog.getByRole("textbox", { name: "السبب" })
    const slug = dialog.getByRole("textbox", { name: "معرّف المنظمة" })
    await expect(slug).toHaveAttribute("dir", "ltr")
    await userEvent.type(reason, "مراجعة تشغيل المنظمة قبل الإيقاف")
    await userEvent.type(slug, platformOrganizationFixture.slug)
    dialog.getByRole("button", { name: "تأكيد الإيقاف" }).focus()
    await userEvent.keyboard("{Enter}")
    await expect(reason).toBeDisabled()
    await waitFor(() =>
      expect(canvas.getByRole("status")).toHaveTextContent("تم إيقاف المنظمة.")
    )
    await expectClosed(screen)
    await expect(
      canvas.getByRole("button", { name: "استئناف المنظمة" })
    ).toHaveFocus()
  },
}
