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
        status={loading ? "loading" : "ready"}
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
    await userEvent.keyboard("{Enter}")
    await expect(canvas.getByText("No results")).toBeVisible()
    await userEvent.clear(
      canvas.getByRole("textbox", { name: "Search records" })
    )
    await userEvent.keyboard("{Enter}")
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
  render: () => (
    <DataTable
      columns={singleStatusColumns}
      data={records}
      getRowId={(row) => row.id}
    />
  ),
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
      canvas.getByRole("checkbox", { name: "Select page" })
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

export const Loading: Story = {
  render: () => (
    <DataTable
      columns={columns}
      data={[]}
      getRowId={(row) => row.id}
      status="loading"
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole("table")).toHaveAttribute("aria-busy", "true")
    await expect(canvas.queryByText("No data yet")).not.toBeInTheDocument()
    await expect(
      canvas.getByRole("checkbox", { name: "Select page" })
    ).toHaveAttribute("aria-disabled", "true")
    await expect(
      canvas.getByRole("button", { name: "Next page" })
    ).toHaveAttribute("aria-disabled", "true")
  },
}

export const Empty: Story = {
  render: () => (
    <DataTable columns={columns} data={[]} getRowId={(row) => row.id} />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("No data yet")).toBeVisible()
    await expect(
      canvas.getByRole("columnheader", { name: /Name/ })
    ).toBeVisible()
    await expect(
      canvas.getByRole("checkbox", { name: "Select page" })
    ).toHaveAttribute("aria-disabled", "true")
  },
}

export const NoResults: Story = {
  render: () => (
    <DataTable
      columns={columns}
      data={records}
      getRowId={(row) => row.id}
      initialState={{ globalFilter: "missing" }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("No results")).toBeVisible()
    await userEvent.click(
      within(canvas.getByRole("table")).getByRole("button", {
        name: "Clear filters",
      })
    )
    await expect(canvas.getByText("Record 01")).toBeVisible()
    await expect(canvas.getByRole("textbox", { name: "Search…" })).toHaveValue(
      ""
    )
  },
}

export const NoVisibleColumns: Story = {
  render: () => (
    <DataTable
      columns={singleStatusColumns}
      data={records}
      getRowId={(row) => row.id}
      initialState={{ columnVisibility: { name: false, status: false } }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("All columns are hidden.")).toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: "Reset columns" }))
    await expect(
      canvas.getByRole("columnheader", { name: /Name/ })
    ).toBeVisible()
    await expect(
      canvas.getByRole("columnheader", { name: /Status/ })
    ).toBeVisible()
  },
}

function EmptyPageTable() {
  const [pagination, setPagination] = useState({ pageIndex: 3, pageSize: 10 })
  return (
    <DataTable
      columns={columns}
      data={records.slice(
        pagination.pageIndex * 10,
        pagination.pageIndex * 10 + 10
      )}
      getRowId={(row) => row.id}
      rowCount={26}
      manualPagination
      state={{ pagination }}
      onPaginationChange={setPagination}
    />
  )
}

export const EmptyPage: Story = {
  render: () => <EmptyPageTable />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("No records on this page")).toBeVisible()
    await expect(canvas.getByText("26 rows")).toBeVisible()
    await userEvent.click(
      canvas.getByRole("button", { name: "Go to first page" })
    )
    await expect(canvas.getByText("Record 01")).toBeVisible()
  },
}

function RequestStatesTable() {
  const [status, setStatus] = useState<
    "ready" | "loading" | "refreshing" | "error" | "forbidden"
  >("ready")
  const [data, setData] = useState(records)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setStatus("refreshing")}>Refresh</Button>
        <Button onClick={() => setStatus("error")}>Fail request</Button>
        <Button onClick={() => setStatus("forbidden")}>Deny access</Button>
        <Button
          onClick={() => {
            setData(records)
            setStatus("ready")
          }}
        >
          Finish request
        </Button>
        <Button
          onClick={() => {
            setData([])
            setStatus("error")
          }}
        >
          Fail initial request
        </Button>
      </div>
      <DataTable
        columns={columns}
        data={data}
        getRowId={(row) => row.id}
        status={status}
        onRetry={() => setStatus(data.length ? "refreshing" : "loading")}
      />
    </div>
  )
}

export const RequestTransitions: Story = {
  render: () => <RequestStatesTable />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getAllByRole("checkbox", { name: "Select row" })[0]!
    )
    await userEvent.click(canvas.getByRole("button", { name: "Refresh" }))
    await expect(canvas.getByText("Refreshing…")).toBeVisible()
    await expect(canvas.getByText("Record 01")).toBeVisible()
    await expect(canvas.getByRole("table")).toHaveAttribute("aria-busy", "true")
    await expect(
      canvas.getAllByRole("checkbox", { name: "Select row" })[0]!
    ).toHaveAttribute("aria-disabled", "true")
    await userEvent.click(canvas.getByRole("button", { name: "Fail request" }))
    await expect(canvas.getByRole("alert")).toHaveTextContent("Refresh failed")
    await expect(canvas.getByText("Record 01")).toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }))
    await expect(canvas.getByText("Refreshing…")).toBeVisible()
    await userEvent.click(
      canvas.getByRole("button", { name: "Finish request" })
    )
    await expect(canvas.getByText("1 rows selected")).toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: "Deny access" }))
    await expect(canvas.getByRole("alert")).toHaveTextContent("Access denied")
    await expect(canvas.queryByRole("table")).not.toBeInTheDocument()
    await expect(canvas.queryByText("Record 01")).not.toBeInTheDocument()
    await expect(
      canvas.queryByRole("button", { name: "View" })
    ).not.toBeInTheDocument()
    await userEvent.click(
      canvas.getByRole("button", { name: "Finish request" })
    )
    await expect(
      canvas.getAllByRole("checkbox", { name: "Select row" })[0]!
    ).not.toBeChecked()
    await userEvent.click(
      canvas.getByRole("button", { name: "Fail initial request" })
    )
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "Unable to load data"
    )
    await expect(canvas.queryByText("No data yet")).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }))
    await expect(canvas.getByRole("table")).toHaveAttribute("aria-busy", "true")
    await userEvent.click(
      canvas.getByRole("button", { name: "Finish request" })
    )
    await expect(canvas.getByText("Record 01")).toBeVisible()
  },
}

export const Error: Story = {
  render: () => (
    <DataTable
      columns={columns}
      data={[]}
      getRowId={(row) => row.id}
      status="error"
    />
  ),
}

export const PermissionDenied: Story = {
  render: () => (
    <DataTable
      columns={columns}
      data={records}
      getRowId={(row) => row.id}
      status="forbidden"
    />
  ),
}

export const ServerPageSelection: Story = {
  render: () => <ControlledTable />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole("button", { name: "Status" }))
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Active" })).toBeVisible()
    )
    await userEvent.keyboard("{Escape}")
    await userEvent.click(
      canvas.getAllByRole("checkbox", { name: "Select row" })[0]!
    )
    await expect(canvas.getByText("1 rows selected")).toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: "Next page" }))
    await expect(canvas.getByText("Record 11")).toBeVisible()
    await expect(canvas.queryByText("1 rows selected")).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole("button", { name: "Previous page" }))
    await expect(
      canvas.getAllByRole("checkbox", { name: "Select row" })[0]!
    ).not.toBeChecked()
  },
}

function ActionTable() {
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const [selection, setSelection] = useState<Record<string, true>>({})
  const [ids, setIds] = useState("")
  return (
    <div className="space-y-3">
      <Button
        onClick={() => {
          setPending(false)
          setFailed(true)
        }}
      >
        Fail action
      </Button>
      <Button
        onClick={() => {
          setPending(false)
          setSelection({})
        }}
      >
        Complete action
      </Button>
      <output aria-label="Submitted ids">{ids}</output>
      <DataTable
        columns={columns}
        data={records}
        getRowId={(row) => row.id}
        isActionPending={pending}
        state={{ rowSelection: selection }}
        onRowSelectionChange={setSelection}
        renderSelectionActions={(rows) => (
          <>
            <Button
              onClick={() => {
                setIds(rows.map((row) => row.id).join(","))
                setFailed(false)
                setPending(true)
              }}
            >
              Apply action
            </Button>
            {failed && <p role="alert">Action failed</p>}
          </>
        )}
      />
    </div>
  )
}

export const ActionPendingAndFailure: Story = {
  render: () => <ActionTable />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getAllByRole("checkbox", { name: "Select row" })[0]!
    )
    await userEvent.click(canvas.getByRole("button", { name: "Apply action" }))
    await expect(canvas.getByLabelText("Submitted ids")).toHaveTextContent("1")
    await expect(
      canvas.getByRole("button", { name: "Apply action" })
    ).toBeDisabled()
    await expect(
      canvas.getByRole("button", { name: "Clear selection" })
    ).toBeDisabled()
    await expect(
      canvas.getByRole("button", { name: "Next page" })
    ).toHaveAttribute("aria-disabled", "true")
    await expect(canvas.getByRole("button", { name: "View" })).toBeDisabled()
    await expect(
      canvas.getAllByRole("checkbox", { name: "Select row" })[0]!
    ).toHaveAttribute("aria-disabled", "true")
    await userEvent.click(canvas.getByRole("button", { name: "Fail action" }))
    await expect(canvas.getByRole("alert")).toHaveTextContent("Action failed")
    await expect(canvas.getByText("1 rows selected")).toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: "Apply action" }))
    await userEvent.click(
      canvas.getByRole("button", { name: "Complete action" })
    )
    await expect(
      canvas.queryByRole("region", { name: "Selection actions" })
    ).not.toBeInTheDocument()
  },
}

function ReorderTable({ pinned }: { pinned: boolean }) {
  return (
    <DataTable
      columns={columns}
      data={records}
      getRowId={(row) => row.id}
      initialState={{
        columnPinning: {
          start: pinned ? ["row-controls", "select", "name", "status"] : [],
          end: [],
        },
      }}
    />
  )
}

export const ReorderWithControlColumns: Story = {
  render: () => <ReorderTable pinned={false} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole("button", { name: "View" }))
    screen.getByRole("button", { name: "Drag to reorder Status" }).focus()
    await userEvent.keyboard("[Space]")
    await userEvent.keyboard("[ArrowUp]")
    await userEvent.keyboard("[Space]")
    await waitFor(() =>
      expect(canvas.getAllByRole("columnheader")[2]).toHaveTextContent("Status")
    )
    await expect(canvas.getAllByRole("columnheader")[3]).toHaveTextContent(
      "Name"
    )
    await expect(
      within(canvas.getAllByRole("columnheader")[1]!).getByRole("checkbox")
    ).toBeVisible()
    await userEvent.keyboard("{Escape}")
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
  },
}

export const ReorderPinnedColumns: Story = {
  ...ReorderWithControlColumns,
  render: () => <ReorderTable pinned />,
  play: async (context) => {
    await ReorderWithControlColumns.play!(context)
    const canvas = within(context.canvasElement)
    for (const header of canvas.getAllByRole("columnheader")) {
      await expect(header).toHaveStyle({ position: "sticky" })
    }
  },
}

export const LongText: Story = {
  render: () => (
    <DataTable
      columns={singleStatusColumns}
      data={[
        { id: "long", name: "Long project name ".repeat(40), status: "active" },
      ]}
      getRowId={(row) => row.id}
    />
  ),
}

export const RTL: Story = {
  globals: { locale: "ar" },
  render: () => <ReorderTable pinned />,
}
