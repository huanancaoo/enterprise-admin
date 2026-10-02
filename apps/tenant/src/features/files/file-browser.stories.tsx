import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import {
  FileBreadcrumbsSchema,
  FileListQuerySchema,
  FilePageSchema,
  FolderResponseSchema,
  type FileEntryResponse,
  type FileListQuery,
} from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import { FileBrowser } from "./file-browser"
import { FilePickerDialog, FolderPickerDialog } from "./file-picker"

const id = (value: number) =>
  `c7dd0a27-4f8a-4aef-8d4c-${String(value).padStart(12, "0")}`
const organizationId = id(800)
const fields = {
  organizationId,
  revision: 1,
  state: "active",
  operationId: null,
  deletedAt: null,
  expiresAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
}
const root = FolderResponseSchema.parse({
  ...fields,
  kind: "folder",
  id: id(1),
  parentId: null,
  name: "Root",
  path: [],
})
const folder = FolderResponseSchema.parse({
  ...fields,
  kind: "folder",
  id: id(2),
  parentId: root.id,
  name: "Manuals",
  path: ["Manuals"],
})
const files = Array.from({ length: 25 }, (_, index) => ({
  ...fields,
  kind: "file",
  id: id(100 + index),
  parentId: root.id,
  name: index === 0 ? "portrait.png" : `Report ${index + 1}.pdf`,
  path: [index === 0 ? "portrait.png" : `Report ${index + 1}.pdf`],
  currentVersion: {
    id: id(200 + index),
    fileId: id(100 + index),
    bytes: 1024 + index,
    contentType: index === 0 ? "image/png" : "application/pdf",
    sha256: "a".repeat(64),
    previewKind: index === 0 ? "image" : "pdf",
    isCurrent: true,
    createdAt: fields.createdAt,
    retiredAt: null,
    expiresAt: null,
  },
}))
const entries = FilePageSchema.parse({
  items: [folder, ...files],
  total: 26,
  page: 1,
  pageSize: 20,
}).items
const nested = FilePageSchema.parse({
  items: [
    {
      ...files[0],
      id: id(150),
      currentVersion: {
        ...files[0]!.currentVersion,
        id: id(250),
        fileId: id(150),
      },
      name: "inside.png",
      parentId: folder.id,
      path: ["Manuals", "inside.png"],
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
}).items

type FixtureProps = {
  mode?: "browser" | "file" | "folder"
  failPick?: boolean
  pendingPick?: boolean
}

function BrowserFixture({
  mode = "browser",
  failPick = false,
  pendingPick = false,
}: FixtureProps) {
  const [currentFolder, setCurrentFolder] = useState(root)
  const [search, setSearch] = useState(
    FileListQuerySchema.parse({ parentId: root.id })
  )
  const [scope, setScope] = useState("user:org:1")
  const [status, setStatus] = useState<"ready" | "forbidden">("ready")
  const [picked, setPicked] = useState("")
  const [aborted, setAborted] = useState(false)
  const [open, setOpen] = useState(false)
  const source = currentFolder.id === root.id ? entries : nested
  const matched = search.name
    ? [...entries, ...nested].filter((entry) =>
        entry.name.toLowerCase().includes(search.name!.toLowerCase())
      )
    : source
  const page = FilePageSchema.parse({
    items: matched.slice(
      (search.page - 1) * search.pageSize,
      search.page * search.pageSize
    ),
    total: matched.length,
    page: search.page,
    pageSize: search.pageSize,
  })
  const browser = {
    contentScopeKey: scope,
    currentFolder,
    search,
    status,
    page,
    breadcrumbs: FileBreadcrumbsSchema.parse({
      items: currentFolder.id === root.id ? [root] : [root, folder],
    }),
    onSearchChange: (updater: (current: FileListQuery) => FileListQuery) =>
      setSearch(updater),
    onOpenFolder: (next: typeof root) => {
      setCurrentFolder(next)
      setSearch((current) => ({
        ...current,
        parentId: next.id,
        name: undefined,
        page: 1,
      }))
    },
    onLocate: (entry: FileEntryResponse) => {
      const parent = entry.parentId === folder.id ? folder : root
      setCurrentFolder(parent)
      setSearch((current) => ({
        ...current,
        parentId: parent.id,
        name: undefined,
        page: 1,
      }))
    },
  }
  const savePick = async (value: unknown, signal: AbortSignal) => {
    if (pendingPick) {
      await new Promise<void>((resolve) =>
        signal.addEventListener(
          "abort",
          () => {
            setAborted(true)
            resolve()
          },
          { once: true }
        )
      )
      return
    }
    if (failPick) throw new Error("This file is no longer available.")
    setPicked(JSON.stringify(value))
  }
  // 固定英文标签只用于驱动和断言 Storybook 夹具，不进入正式产品界面。
  // i18next-instrument-ignore
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <output aria-label="Search conditions">{JSON.stringify(search)}</output>
      <output aria-label="Picked reference">{picked}</output>
      <output aria-label="Request aborted">{String(aborted)}</output>
      {mode === "browser" ? (
        <>
          <Button onClick={() => setStatus("forbidden")}>Deny access</Button>
          <FileBrowser
            {...browser}
            onOpenFile={(file) => setPicked(file.id)}
            renderSelectionActions={(selected) => (
              <Button
                onClick={() =>
                  setPicked(JSON.stringify(selected.map((entry) => entry.id)))
                }
              >
                Read selection
              </Button>
            )}
          />
        </>
      ) : (
        <>
          <Button onClick={() => setOpen(true)}>Open picker</Button>
          {mode === "file" ? (
            <FilePickerDialog
              open={open}
              onOpenChange={setOpen}
              browser={browser}
              allowedContentTypes={["image/png"]}
              getErrorMessage={(error) => (error as Error).message}
              onPick={savePick}
              uploadControl={
                <Button onClick={() => setScope("different-user:org:1")}>
                  Change session
                </Button>
              }
            />
          ) : (
            <FolderPickerDialog
              open={open}
              onOpenChange={setOpen}
              browser={browser}
              canPick={() => true}
              getErrorMessage={(error) => (error as Error).message}
              onPick={savePick}
            />
          )}
        </>
      )}
    </div>
  )
}

const meta = {
  title: "Tenant/Files browser",
  component: BrowserFixture,
  globals: { locale: "en-US" },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof BrowserFixture>
export default meta
type Story = StoryObj<typeof meta>

export const FolderNavigation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole("button", { name: "Manuals" }).closest("tr")!
    await expect(within(row).getByText("—")).toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: "Manuals" }))
    await expect(
      canvas.getByRole("button", { name: "inside.png" })
    ).toBeVisible()
    await expect(
      canvas.getByRole("button", { name: "Manuals" })
    ).toHaveAttribute("aria-current", "page")
    await expect(canvas.getByLabelText("Search conditions")).toHaveTextContent(
      folder.id
    )
    await userEvent.click(canvas.getByRole("button", { name: "Root folder" }))
    await expect(
      canvas.getByRole("button", { name: "portrait.png" })
    ).toBeVisible()
  },
}

export const SearchAndLocate: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const search = canvas.getByRole("textbox", {
      name: "Search files and folders in this organization",
    })
    await userEvent.type(search, "inside")
    await userEvent.keyboard("{Enter}")
    await expect(
      canvas.getByText(/Searching this organization/)
    ).toHaveAttribute("role", "status")
    await userEvent.click(canvas.getByRole("button", { name: "Manuals" }))
    await expect(
      canvas.getByRole("button", { name: "inside.png" })
    ).toBeVisible()
    await expect(
      canvas.getByLabelText("Search conditions")
    ).not.toHaveTextContent('"name":"inside"')
  },
}

export const SelectionClearsOnPageAndFolder: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getAllByRole("checkbox", { name: "Select row" })[0]!
    )
    await expect(
      canvas.getByRole("region", { name: "Selection actions" })
    ).toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: "Next page" }))
    await expect(
      canvas.queryByRole("region", { name: "Selection actions" })
    ).not.toBeInTheDocument()
    await expect(canvas.getByLabelText("Search conditions")).toHaveTextContent(
      '"page":2'
    )
    await userEvent.click(canvas.getByRole("button", { name: "Previous page" }))
    await userEvent.click(
      canvas.getAllByRole("checkbox", { name: "Select row" })[0]!
    )
    await userEvent.click(canvas.getByRole("button", { name: "Manuals" }))
    await expect(
      canvas.queryByRole("region", { name: "Selection actions" })
    ).not.toBeInTheDocument()
  },
}

export const PermissionRevoked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Deny access" }))
    await expect(canvas.getByText("Access denied")).toBeVisible()
    await expect(canvas.queryByRole("table")).not.toBeInTheDocument()
    await expect(
      canvas.queryByRole("navigation", { name: "Folder navigation" })
    ).not.toBeInTheDocument()
    await expect(canvas.queryByText("portrait.png")).not.toBeInTheDocument()
  },
}

async function openPicker(canvasElement: HTMLElement) {
  await userEvent.click(
    within(canvasElement).getByRole("button", { name: "Open picker" })
  )
  return within(
    await within(canvasElement.ownerDocument.body).findByRole("dialog")
  )
}

export const FilePickerVersionReference: Story = {
  args: { mode: "file" },
  play: async ({ canvasElement }) => {
    const popup = await openPicker(canvasElement)
    await expect(popup.getByRole("button", { name: "Use file" })).toBeDisabled()
    await userEvent.click(popup.getByRole("button", { name: "Manuals" }))
    await expect(popup.getByRole("button", { name: "Use file" })).toBeDisabled()
    await userEvent.click(popup.getByRole("button", { name: "Root folder" }))
    await expect(
      popup.getByRole("button", { name: "Report 2.pdf" })
    ).toBeDisabled()
    popup.getByRole("button", { name: "portrait.png" }).focus()
    await userEvent.keyboard("{Enter}")
    popup.getByRole("button", { name: "Use file" }).focus()
    await userEvent.keyboard("{Enter}")
    await waitFor(() =>
      expect(
        within(canvasElement.ownerDocument.body).queryByRole("dialog")
      ).not.toBeInTheDocument()
    )
    const expected = JSON.stringify({ fileId: id(100), versionId: id(200) })
    await expect(
      within(canvasElement).getByLabelText("Picked reference")
    ).toHaveTextContent(expected)
    await expect(
      within(canvasElement).getByRole("button", { name: "Open picker" })
    ).toHaveFocus()
  },
}

export const FilePickerFailureKeepsSelection: Story = {
  args: { mode: "file", failPick: true },
  play: async ({ canvasElement }) => {
    const popup = await openPicker(canvasElement)
    await userEvent.click(popup.getByRole("button", { name: "portrait.png" }))
    await userEvent.click(popup.getByRole("button", { name: "Use file" }))
    await expect(await popup.findByRole("alert")).toHaveTextContent(
      "This file is no longer available."
    )
    await expect(popup.getByRole("status")).toHaveTextContent(
      "Selected: portrait.png"
    )
    await expect(popup.getByRole("button", { name: "Use file" })).toBeEnabled()
    await expect(
      within(canvasElement).getByLabelText("Picked reference")
    ).toBeEmptyDOMElement()
  },
}

export const FilePickerScopeCancelsPending: Story = {
  args: { mode: "file", pendingPick: true },
  play: async ({ canvasElement }) => {
    const popup = await openPicker(canvasElement)
    await userEvent.click(popup.getByRole("button", { name: "portrait.png" }))
    await userEvent.click(popup.getByRole("button", { name: "Use file" }))
    await expect(
      await popup.findByRole("button", { name: "Submitting…" })
    ).toBeDisabled()
    await userEvent.keyboard("{Escape}")
    await expect(
      within(canvasElement.ownerDocument.body).getByRole("dialog")
    ).toBeVisible()
    await userEvent.click(popup.getByRole("button", { name: "Change session" }))
    await waitFor(() =>
      expect(
        within(canvasElement).getByLabelText("Request aborted")
      ).toHaveTextContent("true")
    )
    const current = within(
      within(canvasElement.ownerDocument.body).getByRole("dialog")
    )
    await expect(
      current.getByRole("button", { name: "Use file" })
    ).toBeDisabled()
    await expect(current.getByRole("status")).toHaveTextContent(
      "Choose an available file."
    )
  },
}

export const FolderPickerChoosesDirectory: Story = {
  args: { mode: "folder" },
  play: async ({ canvasElement }) => {
    const popup = await openPicker(canvasElement)
    await expect(
      popup.getByRole("button", { name: "portrait.png" })
    ).toBeDisabled()
    await userEvent.click(popup.getByRole("button", { name: "Manuals" }))
    await userEvent.click(
      popup.getByRole("button", { name: "Use this folder" })
    )
    await waitFor(() =>
      expect(
        within(canvasElement.ownerDocument.body).queryByRole("dialog")
      ).not.toBeInTheDocument()
    )
    await expect(
      within(canvasElement).getByLabelText("Picked reference")
    ).toHaveTextContent(JSON.stringify(folder))
  },
}

export const Chinese: Story = {
  globals: { locale: "zh-CN" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole("navigation", { name: "文件夹导航" })
    ).toBeVisible()
    await expect(
      canvas.getByRole("textbox", { name: "搜索本组织的文件和文件夹" })
    ).toBeVisible()
  },
}
export const Arabic: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole("navigation", { name: "التنقل بين المجلدات" })
    ).toBeVisible()
    await expect(canvasElement.ownerDocument.documentElement).toHaveAttribute(
      "dir",
      "rtl"
    )
  },
}

export const SortingUpdatesConditions: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Next page" }))
    await userEvent.click(
      canvas.getAllByRole("checkbox", { name: "Select row" })[0]!
    )
    await userEvent.click(canvas.getByRole("button", { name: "Size" }))
    await expect(canvas.getByLabelText("Search conditions")).toHaveTextContent(
      '"sortBy":"size"'
    )
    await expect(canvas.getByLabelText("Search conditions")).toHaveTextContent(
      '"page":1'
    )
    await expect(
      canvas.queryByRole("region", { name: "Selection actions" })
    ).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole("button", { name: "Updated at" }))
    await expect(canvas.getByLabelText("Search conditions")).toHaveTextContent(
      '"sortBy":"updatedAt"'
    )
    await userEvent.click(canvas.getByRole("button", { name: "Name" }))
    await expect(canvas.getByLabelText("Search conditions")).toHaveTextContent(
      '"sortBy":"name"'
    )
  },
}
