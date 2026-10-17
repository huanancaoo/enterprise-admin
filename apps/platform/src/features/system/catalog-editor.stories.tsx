import { useState } from "react"
import { useTranslation } from "react-i18next"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import { AuthenticatedSessionProvider } from "@workspace/admin/auth"
import {
  createWorkspaceSessionHandlers,
  platformOrganizationActor,
} from "@workspace/mocks"
import { authClient } from "../../lib/auth-client"
import { CatalogEditorDialog } from "./catalog-components"

function CatalogEditorStory({
  mode = "success",
}: {
  mode?: "success" | "failure" | "pending"
}) {
  const [router] = useState(() => {
    function Editor() {
      const { t } = useTranslation(["catalogs", "common"])
      const [closed, setClosed] = useState(false)
      return closed ? (
        <p role="status">{t("catalogs:saved")}</p>
      ) : (
        <CatalogEditorDialog
          title={t("catalogs:create")}
          fields={["key", "name"]}
          initial={{
            key: "",
            name: "",
            label: "",
            value: "",
            remark: "",
            status: "active",
            sort: 0,
          }}
          statuses={[
            { value: "active", label: t("catalogs:active") },
            { value: "disabled", label: t("catalogs:disabled") },
          ]}
          onClose={() => setClosed(true)}
          onSave={async () => {
            if (mode === "failure")
              throw new Error("Save failed. Draft is preserved.")
            if (mode === "pending") await new Promise<void>(() => {})
          }}
        />
      )
    }
    return createRouter({
      routeTree: createRootRoute({ component: Editor }),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    })
  })
  return (
    <AuthenticatedSessionProvider
      client={authClient}
      user={platformOrganizationActor}
    >
      <RouterProvider router={router} />
    </AuthenticatedSessionProvider>
  )
}
const meta = {
  title: "Platform/System catalog editor",
  component: CatalogEditorStory,
  globals: { locale: "en-US" },
  parameters: { msw: { handlers: createWorkspaceSessionHandlers() } },
} satisfies Meta<typeof CatalogEditorStory>
export default meta
type Story = StoryObj<typeof meta>
async function fill(canvasElement: HTMLElement) {
  const dialog = within(
    await within(canvasElement.ownerDocument.body).findByRole("dialog")
  )
  await expect(
    dialog.getByRole("combobox", { name: "Status" })
  ).toHaveTextContent("Active")
  await userEvent.type(dialog.getByLabelText("Key"), "operations")
  await userEvent.type(dialog.getByLabelText("Name"), "Operations")
  return dialog
}
export const Submit: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await fill(canvasElement)
    await userEvent.click(dialog.getByRole("button", { name: "Save" }))
    await within(canvasElement).findByText("Saved.")
  },
}
export const RequiredAndCorrection: Story = {
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body)
    const dialog = within(await screen.findByRole("dialog"))
    await userEvent.click(dialog.getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(dialog.getByLabelText("Key")).toHaveAttribute(
        "aria-invalid",
        "true"
      )
    )
    await userEvent.type(dialog.getByLabelText("Key"), "operations")
    await userEvent.type(dialog.getByLabelText("Name"), "Operations")
    await userEvent.click(dialog.getByRole("button", { name: "Save" }))
    await within(canvasElement).findByText("Saved.")
  },
}
export const ServerError: Story = {
  args: { mode: "failure" },
  play: async ({ canvasElement }) => {
    const dialog = await fill(canvasElement)
    await userEvent.click(dialog.getByRole("button", { name: "Save" }))
    await dialog.findByRole("alert")
    await expect(dialog.getByLabelText("Key")).toHaveValue("operations")
    await expect(dialog.getByLabelText("Name")).toHaveValue("Operations")
  },
}
export const Pending: Story = {
  args: { mode: "pending" },
  play: async ({ canvasElement }) => {
    const dialog = await fill(canvasElement)
    await userEvent.click(dialog.getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(dialog.getByRole("button", { name: "Submitting…" })).toBeDisabled()
    )
    await expect(dialog.getByLabelText("Name")).toBeDisabled()
  },
}
export const RTL: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    const dialog = within(
      await within(canvasElement.ownerDocument.body).findByRole("dialog")
    )
    await expect(
      dialog.getByRole("combobox", { name: "الحالة" })
    ).toHaveTextContent("نشط")
    await expect(canvasElement.ownerDocument.documentElement).toHaveAttribute(
      "dir",
      "rtl"
    )
  },
}
