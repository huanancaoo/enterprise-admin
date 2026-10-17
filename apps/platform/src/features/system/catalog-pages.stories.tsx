import { useState } from "react"
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
import { AuthenticatedSessionProvider } from "@workspace/admin/auth"
import {
  createPlatformCatalogScenario,
  createWorkspaceSessionHandlers,
  platformOrganizationActor,
  catalogDictionaryId,
  type PlatformCatalogScenario,
} from "@workspace/mocks"
import {
  PlatformSystemQuerySchema,
  PlatformDictionaryItemsQuerySchema,
  PlatformSystemTreeQuerySchema,
} from "@workspace/contracts/platform-system"
import { authClient } from "../../lib/auth-client"
import {
  PlatformPostsPage,
  PlatformDictionariesPage,
  PlatformDictionaryItemsPage,
  PlatformParametersPage,
} from "./catalog-pages"
import { PlatformMenusPage, PlatformDepartmentsPage } from "./tree-pages"

function CatalogPageStory({
  page = "posts",
  readOnly = false,
}: {
  page?:
    "posts" | "dictionaries" | "items" | "parameters" | "menus" | "departments"
  readOnly?: boolean
}) {
  const [router] = useState(() => {
    const root = createRootRoute()
    const platform = createRoute({
      getParentRoute: () => root,
      path: "platform",
      beforeLoad: () => ({
        platformAccess: {
          userId: platformOrganizationActor.id,
          roles: [],
          permissions: [
            "post",
            "dictionary",
            "parameter",
            "menu",
            "department",
          ].flatMap((resource) =>
            (readOnly
              ? ["read"]
              : ["read", "create", "update", "delete", "refresh"]
            ).map((action) => `platform.${resource}:${action}`)
          ),
          scope: "global",
          mfaVerifiedAt: "2026-10-17T00:00:00.000Z",
        },
      }),
      component: Outlet,
    })
    const posts = createRoute({
      getParentRoute: () => platform,
      path: "posts",
      validateSearch: (search) => PlatformSystemQuerySchema.parse(search),
      component: PlatformPostsPage,
    })
    const dictionaries = createRoute({
      getParentRoute: () => platform,
      path: "dictionaries",
      validateSearch: (search) => PlatformSystemQuerySchema.parse(search),
      component: PlatformDictionariesPage,
    })
    const items = createRoute({
      getParentRoute: () => platform,
      path: "dictionaries/$dictionaryId/items",
      validateSearch: (search) =>
        PlatformDictionaryItemsQuerySchema.parse(search),
      component: PlatformDictionaryItemsPage,
    })
    const parameters = createRoute({
      getParentRoute: () => platform,
      path: "parameters",
      validateSearch: (search) => PlatformSystemQuerySchema.parse(search),
      component: PlatformParametersPage,
    })
    const menus = createRoute({
      getParentRoute: () => platform,
      path: "menus",
      validateSearch: (search) => PlatformSystemTreeQuerySchema.parse(search),
      component: PlatformMenusPage,
    })
    const departments = createRoute({
      getParentRoute: () => platform,
      path: "departments",
      validateSearch: (search) => PlatformSystemTreeQuerySchema.parse(search),
      component: PlatformDepartmentsPage,
    })
    return createRouter({
      routeTree: root.addChildren([
        platform.addChildren([
          posts,
          dictionaries,
          items,
          parameters,
          menus,
          departments,
        ]),
      ]),
      history: createMemoryHistory({
        initialEntries: [
          page === "items"
            ? `/platform/dictionaries/${catalogDictionaryId}/items`
            : `/platform/${page}`,
        ],
      }),
    })
  })
  return (
    <AuthenticatedSessionProvider
      client={authClient}
      user={platformOrganizationActor}
    >
      <main className="mx-auto max-w-6xl p-5">
        <RouterProvider router={router} />
      </main>
    </AuthenticatedSessionProvider>
  )
}
function scenario(name: PlatformCatalogScenario = "success") {
  const fixture = createPlatformCatalogScenario(name)
  return {
    fixture,
    story: {
      beforeEach: fixture.reset,
      parameters: {
        layout: "fullscreen",
        msw: {
          handlers: [...fixture.handlers, ...createWorkspaceSessionHandlers()],
        },
      },
    },
  }
}
const defaults = scenario()
const meta = {
  title: "Platform/System catalogs",
  component: CatalogPageStory,
  globals: { locale: "en-US" },
  ...defaults.story,
} satisfies Meta<typeof CatalogPageStory>
export default meta
type Story = StoryObj<typeof meta>

export const Posts: Story = {
  args: { page: "posts" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("table")
    await expect(canvas.getByRole("heading", { name: "Posts" })).toBeVisible()
    await expect(canvas.getByRole("button", { name: "Create" })).toBeVisible()
  },
}
const paging = scenario()
export const PostServerPagination: Story = {
  ...paging.story,
  args: { page: "posts" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("table")
    await waitFor(() => expect(canvas.getAllByRole("row")).toHaveLength(21))
    await userEvent.click(canvas.getByRole("button", { name: "Next page" }))
    await waitFor(() => expect(canvas.getAllByRole("row")).toHaveLength(6))
    await expect(paging.fixture.queries.at(-1)?.get("page")).toBe("2")
  },
}
const create = scenario()
export const PostCreate: Story = {
  ...create.story,
  args: { page: "posts" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("table")
    await userEvent.click(canvas.getByRole("button", { name: "Create" }))
    const screen = within(canvasElement.ownerDocument.body)
    const dialog = within(await screen.findByRole("dialog"))
    await userEvent.type(dialog.getByLabelText("Key"), "quality")
    await userEvent.type(dialog.getByLabelText("Name"), "Quality")
    await userEvent.click(dialog.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await expect(create.fixture.writes).toEqual([
      { key: "quality", name: "Quality", status: "active", sort: 0 },
    ])
  },
}
const saveError = scenario("saveError")
export const PostSaveErrorKeepsDraft: Story = {
  ...saveError.story,
  args: { page: "posts" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("table")
    await userEvent.click(canvas.getByRole("button", { name: "Create" }))
    const dialog = within(
      await within(canvasElement.ownerDocument.body).findByRole("dialog")
    )
    await userEvent.type(dialog.getByLabelText("Key"), "quality")
    await userEvent.type(dialog.getByLabelText("Name"), "Quality")
    await userEvent.click(dialog.getByRole("button", { name: "Save" }))
    await dialog.findByRole("alert")
    await expect(dialog.getByLabelText("Name")).toHaveValue("Quality")
  },
}
export const PostValidation: Story = {
  args: { page: "posts" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("table")
    await userEvent.click(canvas.getByRole("button", { name: "Create" }))
    const dialog = within(
      await within(canvasElement.ownerDocument.body).findByRole("dialog")
    )
    await userEvent.click(dialog.getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(dialog.getByLabelText("Key")).toHaveAttribute(
        "aria-invalid",
        "true"
      )
    )
    await expect(dialog.getByLabelText("Name")).toHaveAttribute(
      "aria-invalid",
      "true"
    )
  },
}
export const ReadOnly: Story = {
  args: { page: "posts", readOnly: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("table")
    await expect(canvas.queryByRole("button", { name: "Create" })).toBeNull()
    await expect(canvas.queryByRole("button", { name: "Edit" })).toBeNull()
  },
}
export const Loading: Story = {
  ...scenario("loading").story,
  args: { page: "posts" },
}
export const Empty: Story = {
  ...scenario("empty").story,
  args: { page: "posts" },
}
export const Error: Story = {
  ...scenario("error").story,
  args: { page: "posts" },
}
export const Dictionaries: Story = { args: { page: "dictionaries" } }
export const DictionaryItems: Story = { args: { page: "items" } }
export const Parameters: Story = { args: { page: "parameters" } }
export const Menus: Story = {
  args: { page: "menus" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole("button", { name: "View children" })
    )
    await userEvent.click(await canvas.findByRole("button", { name: "Edit" }))
    const dialog = within(
      await within(canvasElement.ownerDocument.body).findByRole("dialog")
    )
    await expect(
      dialog.getByRole("combobox", { name: "Node type" })
    ).toHaveTextContent("Internal page")
    await expect(
      dialog.getByRole("combobox", { name: "Status" })
    ).toHaveTextContent("Disabled")
    await waitFor(() =>
      expect(
        dialog.getByRole("combobox", { name: "Registered page" })
      ).toHaveTextContent("posts · /platform/posts")
    )
  },
}
const hierarchy = scenario()
export const DepartmentParentNavigation: Story = {
  ...hierarchy.story,
  args: { page: "departments" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("table")
    await userEvent.click(
      await canvas.findByRole("button", { name: "View children" })
    )
    await waitFor(() =>
      expect(hierarchy.fixture.queries.at(-1)?.get("parentId")).toBe(
        "c7dd0a27-4f8a-4aef-8d4c-000000000200"
      )
    )
    await canvas.findByText("Support")
    const nav = canvas.getByRole("navigation", { name: "Current hierarchy" })
    await expect(
      within(nav).getByRole("button", { name: "Operations" })
    ).toBeVisible()
    await expect(canvas.queryByRole("button", { name: "Next page" })).toBeNull()
    await expect(hierarchy.fixture.queries.at(-1)?.get("parentId")).toBe(
      "c7dd0a27-4f8a-4aef-8d4c-000000000200"
    )
  },
}
export const RTL: Story = {
  args: { page: "menus" },
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("table")
    await userEvent.click(canvas.getByRole("button", { name: "إضافة" }))
    const dialog = within(
      await within(canvasElement.ownerDocument.body).findByRole("dialog")
    )
    await expect(
      dialog.getByRole("combobox", { name: "نوع العقدة" })
    ).toHaveTextContent("دليل")
    await expect(
      dialog.getByRole("combobox", { name: "الحالة" })
    ).toHaveTextContent("نشط")
    await expect(canvasElement.ownerDocument.documentElement).toHaveAttribute(
      "dir",
      "rtl"
    )
  },
}
