import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import {
  DataTable,
  DataTableColumnHeader,
  createDataTableColumnHelper,
  createDataTableRowControlsColumn,
  createDataTableSelectColumn,
} from "@workspace/admin"
import { Button } from "@workspace/ui/components/button"

type RecordRow = { id: string; name: string; status: string }

const records: RecordRow[] = Array.from({ length: 26 }, (_, index) => ({
  id: String(index + 1),
  name: `Record ${String(index + 1).padStart(2, "0")}`,
  status: index % 2 === 0 ? "active" : "invited",
}))
const helper = createDataTableColumnHelper<RecordRow>()
const columns = helper.columns([
  createDataTableRowControlsColumn<RecordRow>(),
  createDataTableSelectColumn<RecordRow>(),
  helper.accessor("name", {
    header: ({ header }) => (
      <DataTableColumnHeader header={header} title="Name" />
    ),
    meta: { label: "Name" },
  }),
  helper.accessor("status", {
    header: "Status",
    meta: {
      label: "Status",
      facetOptions: [
        { label: "Active", value: "active" },
        { label: "Invited", value: "invited" },
      ],
    },
  }),
])

const singleStatusColumns = helper.columns([
  helper.accessor("name", {
    header: "Name",
    meta: { label: "Name" },
  }),
  helper.accessor("status", {
    header: "Status",
    meta: {
      label: "Status",
      facetMode: "single",
      facetOptions: [
        { label: "Active", value: "active" },
        { label: "Invited", value: "invited" },
      ],
    },
  }),
])

function TableExample() {
  const [loading, setLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState("")
  return (
    <div className="space-y-4">
      <Button onClick={() => setLoading((value) => !value)}>
        Toggle loading
      </Button>
      <output aria-label="Action result">{selectedIds}</output>
      <DataTable
        columns={columns}
        data={records}
        getRowId={(row) => row.id}
        getRowCanExpand={() => true}
        isLoading={loading}
        searchPlaceholder="Search records"
        empty={<p>No matching records</p>}
        initialState={{
          columnPinning: { start: ["row-controls", "select", "name"], end: [] },
        }}
        renderExpandedRow={({ original }) => <p>Details for {original.name}</p>}
        renderSelectionActions={(rows) => (
          <Button
            onClick={() =>
              setSelectedIds(rows.map((row) => row.original.id).join(","))
            }
          >
            Apply action
          </Button>
        )}
      />
    </div>
  )
}

const meta = {
  globals: { locale: "en-US" },
  title: "Admin/DataTable",
  component: TableExample,
  parameters: { a11y: { test: "error" } },
} satisfies Meta<typeof TableExample>
export default meta
type Story = StoryObj<typeof meta>

export const ContentStates: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getAllByRole("button", { name: "Expand row" })[0]!
    )
    await expect(canvas.getByText("Details for Record 01")).toBeVisible()
    await userEvent.click(
      canvas.getByRole("button", { name: "Toggle loading" })
    )
    await expect(canvas.getByRole("table")).toHaveAttribute("aria-busy", "true")
    await expect(
      canvas.queryByText("Record 01", { exact: true })
    ).not.toBeInTheDocument()
    await expect(
      canvas.queryByText("Details for Record 01")
    ).not.toBeInTheDocument()
    await userEvent.click(
      canvas.getByRole("button", { name: "Toggle loading" })
    )
    await expect(canvas.getByText("Details for Record 01")).toBeVisible()
    await expect(canvas.getByRole("table")).toHaveAttribute(
      "aria-busy",
      "false"
    )
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Search records" }),
      "missing"
    )
    await expect(canvas.getByText("No matching records")).toBeVisible()
    await userEvent.clear(
      canvas.getByRole("textbox", { name: "Search records" })
    )
    await expect(canvas.getByText("Record 01", { exact: true })).toBeVisible()
  },
}

export const FilteringAndSelection: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole("button", { name: "Status" }))
    await userEvent.click(await screen.findByRole("option", { name: /Active/ }))
    await userEvent.keyboard("{Escape}")
    await expect(canvas.getByText("13 rows")).toBeVisible()
    await expect(canvas.queryByText("Record 02")).not.toBeInTheDocument()
    await userEvent.click(
      canvas.getAllByRole("checkbox", { name: "Select row" })[0]!
    )
    await userEvent.click(canvas.getByRole("button", { name: "Next page" }))
    await expect(canvas.getByText("Record 21")).toBeVisible()
    await userEvent.click(
      canvas.getAllByRole("checkbox", { name: "Select row" })[0]!
    )
    await expect(canvas.getByText("2 rows selected")).toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: "Apply action" }))
    await expect(canvas.getByLabelText("Action result")).toHaveTextContent(
      "1,21"
    )
    await userEvent.click(
      canvas.getByRole("button", { name: "Clear selection" })
    )
    await expect(
      canvas.queryByRole("region", { name: "Selection actions" })
    ).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole("button", { name: /Status Active/ }))
    await userEvent.click(
      await screen.findByRole("option", { name: /Invited/ })
    )
    await userEvent.keyboard("{Escape}")
    await expect(canvas.getByText("26 rows")).toBeVisible()
    await userEvent.click(
      canvas.getByRole("button", { name: /Status Active Invited/ })
    )
    await userEvent.click(
      await screen.findByRole("option", { name: "Clear filters" })
    )
    await userEvent.keyboard("{Escape}")
    await expect(canvas.getByRole("button", { name: "Status" })).toBeVisible()
    await expect(canvas.getByText("Record 02")).toBeVisible()
    // 等待弹层退场完成，再由 Storybook 检查稳定界面的可访问性。
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
  },
}

export const SingleStatusFilter: Story = {
  render: () => <DataTable columns={singleStatusColumns} data={records} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole("button", { name: "Status" }))
    await userEvent.click(await screen.findByRole("option", { name: /Active/ }))
    await expect(
      canvas.getByRole("button", { name: "Status Active" })
    ).toBeVisible()
    await userEvent.click(
      await screen.findByRole("option", { name: /Invited/ })
    )
    await expect(
      canvas.getByRole("button", { name: "Status Invited" })
    ).toBeVisible()
    await expect(
      canvas.queryByRole("button", { name: "Status Active Invited" })
    ).not.toBeInTheDocument()
  },
}

export const ColumnSettings: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole("button", { name: "View" }))
    await expect(
      screen.queryByRole("checkbox", { name: "Show Selection" })
    ).not.toBeInTheDocument()
    await expect(
      screen.queryByRole("checkbox", { name: "Show Row controls" })
    ).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("checkbox", { name: "Show Status" }))
    await expect(
      canvas.queryByRole("columnheader", { name: /Status/ })
    ).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Reset columns" }))
    await expect(
      canvas.getByRole("columnheader", { name: /Status/ })
    ).toBeVisible()
    await userEvent.click(screen.getByRole("combobox", { name: "Pin Status" }))
    await userEvent.click(await screen.findByRole("option", { name: "Start" }))
    await expect(
      canvas.getByRole("columnheader", { name: /Status/ })
    ).toHaveStyle({ position: "sticky" })
    await userEvent.click(screen.getByRole("button", { name: "Reset columns" }))
    await expect(
      canvas.getByRole("columnheader", { name: /Status/ })
    ).toHaveStyle({ position: "relative" })
    await userEvent.click(canvas.getByRole("button", { name: "View" }))
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    await expect(
      canvas.getByRole("checkbox", { name: "Select all" })
    ).toBeVisible()
  },
}

function ControlledTable() {
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 })
  // 模拟服务端只返回当前页，验证组件不会再次对响应数据切页。
  const page = records.slice(
    pagination.pageIndex * pagination.pageSize,
    (pagination.pageIndex + 1) * pagination.pageSize
  )
  return (
    <>
      <Button onClick={() => setPagination({ pageIndex: 2, pageSize: 10 })}>
        Open last page
      </Button>
      <output aria-label="Current page">{pagination.pageIndex + 1}</output>
      <DataTable
        columns={columns}
        data={page}
        getRowId={(row) => row.id}
        state={{ pagination }}
        onPaginationChange={setPagination}
        manualPagination
        rowCount={records.length}
      />
    </>
  )
}

export const ControlledPagination: Story = {
  render: () => <ControlledTable />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Next page" }))
    await waitFor(() =>
      expect(canvas.getByLabelText("Current page")).toHaveTextContent("2")
    )
    await expect(canvas.getByText("Record 11")).toBeVisible()
    await expect(canvas.queryByText("Record 01")).not.toBeInTheDocument()
    await userEvent.click(
      canvas.getByRole("button", { name: "Open last page" })
    )
    await expect(canvas.getByText("Record 21")).toBeVisible()
    await expect(
      canvas.getAllByRole("checkbox", { name: "Select row" })
    ).toHaveLength(6)
    await userEvent.click(canvas.getByRole("button", { name: "Previous page" }))
    await expect(canvas.getByLabelText("Current page")).toHaveTextContent("2")
    await expect(canvas.getByText("Record 11")).toBeVisible()
  },
}
