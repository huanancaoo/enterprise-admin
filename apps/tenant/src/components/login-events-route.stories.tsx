import { useState } from "react"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test"
import {
  AuthenticatedSessionProvider,
  createWorkspaceAuthClient,
} from "@workspace/admin/auth"
import { PersonalLoginLogsQuerySchema } from "@workspace/contracts/identity-management"
import {
  createPlatformIdentityScenario,
  taskCenterUser,
  type PlatformIdentityScenario,
} from "@workspace/mocks"
import { PersonalLoginEventsRoute } from "./login-events-route"

const authClient = createWorkspaceAuthClient()

function LoginEventsStory({ initialSearch = "" }: { initialSearch?: string }) {
  const [router] = useState(() => {
    const root = createRootRoute({
      component: () => (
        <main className="mx-auto max-w-6xl p-6">
          <Outlet />
        </main>
      ),
    })
    const route = createRoute({
      getParentRoute: () => root,
      path: "/app/settings/login-events",
      validateSearch: (search) => PersonalLoginLogsQuerySchema.parse(search),
      component: PersonalLoginEventsRoute,
    })
    return createRouter({
      routeTree: root.addChildren([route]),
      history: createMemoryHistory({
        initialEntries: [`/app/settings/login-events${initialSearch}`],
      }),
    })
  })
  return (
    <AuthenticatedSessionProvider client={authClient} user={taskCenterUser}>
      <RouterProvider router={router} />
    </AuthenticatedSessionProvider>
  )
}

const scenario = (name: PlatformIdentityScenario = "success") => {
  const fixture = createPlatformIdentityScenario(name)
  return {
    beforeEach: fixture.reset,
    parameters: { layout: "fullscreen", msw: { handlers: fixture.handlers } },
  }
}

const defaultFixture = createPlatformIdentityScenario()
const meta = {
  title: "Tenant/Personal login history",
  component: LoginEventsStory,
  globals: { locale: "en-US" },
  beforeEach: defaultFixture.reset,
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    msw: { handlers: defaultFixture.handlers },
  },
} satisfies Meta<typeof LoginEventsStory>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("heading", { name: "My login history" })
    await canvas.findByRole("table")
    await expect(canvas.queryByRole("searchbox")).toBeNull()
    await expect(canvas.queryByText("Platform Operator")).toBeNull()
    await expect(
      canvas.getByRole("button", { name: "Advanced filters" })
    ).toBeVisible()
    await expect(
      canvas.queryByRole("button", { name: "Filter by account" })
    ).toBeNull()
    await expect(defaultFixture.personalLoginQueries.length).toBeGreaterThan(0)
    const params = defaultFixture.personalLoginQueries.at(-1)!
    await expect(params.has("userId")).toBe(false)
    await expect(params.has("organizationId")).toBe(false)
  },
}

const dateFilterFixture = createPlatformIdentityScenario()
export const DateFilters: Story = {
  args: { initialSearch: "?result=failed&method=email&page=2&pageSize=10" },
  beforeEach: dateFilterFixture.reset,
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    msw: { handlers: dateFilterFixture.handlers },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("table")
    const filterButton = canvas.getByRole("button", {
      name: "Advanced filters",
    })
    await waitFor(() => expect(filterButton).toBeEnabled())
    await userEvent.click(filterButton)
    const screen = within(canvasElement.ownerDocument.body)
    fireEvent.change(await screen.findByLabelText("From (UTC)"), {
      target: { value: "2026-10-16T10:30" },
    })
    fireEvent.change(await screen.findByLabelText("To (UTC)"), {
      target: { value: "2026-10-16T11:30" },
    })
    await userEvent.click(screen.getByRole("button", { name: "Apply filters" }))
    await waitFor(() => {
      const params = dateFilterFixture.personalLoginQueries.at(-1)
      expect(params?.get("from")).toBe("2026-10-16T10:30:00Z")
      expect(params?.get("to")).toBe("2026-10-16T11:30:00Z")
      expect(params?.get("result")).toBe("failed")
      expect(params?.get("method")).toBe("email")
      expect(params?.get("page")).toBe("1")
      expect(params?.has("userId")).toBe(false)
      expect(params?.has("organizationId")).toBe(false)
    })
    await waitFor(() =>
      expect(
        canvasElement.ownerDocument.querySelector(
          '[data-slot="popover-content"]'
        )
      ).toBeNull()
    )
  },
}

export const FilteredFromUrl: Story = {
  args: { initialSearch: "?result=failed&method=email&page=2&pageSize=10" },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("table")
    await waitFor(() =>
      expect(defaultFixture.personalLoginQueries.length).toBeGreaterThan(0)
    )
    const params = defaultFixture.personalLoginQueries.at(-1)!
    await expect(params.get("result")).toBe("failed")
    await expect(params.get("method")).toBe("email")
    await expect(params.get("page")).toBe("2")
    await expect(params.get("pageSize")).toBe("10")
  },
}

export const Loading: Story = {
  ...scenario("loading"),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("status")
  },
}

export const Empty: Story = {
  ...scenario("empty"),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByText(
      "No login records match these filters."
    )
  },
}

export const Error: Story = {
  ...scenario("unavailable"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("alert")
    await canvas.findByRole("button", { name: "Retry" })
  },
}

export const RTL: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("table")
    await expect(canvasElement.ownerDocument.documentElement).toHaveAttribute(
      "dir",
      "rtl"
    )
  },
}
