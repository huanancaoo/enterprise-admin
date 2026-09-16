"use client"

import * as React from "react"
import { useTranslation } from "react-i18next"
import { useUiLocale } from "@workspace/i18n/react"
import { localeMeta, createFormatter } from "@workspace/i18n"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import {
  Subscribe,
  type Column,
  type Header,
  type Row,
  type RowData,
  type Table as TanStackTable,
  type TableOptions,
} from "@tanstack/react-table"
import { cn } from "cn"
import {
  ArrowDownIcon,
  ArrowDownToLineIcon,
  ArrowUpIcon,
  ArrowUpToLineIcon,
  ChevronsUpDownIcon,
  ChevronRightIcon,
  CirclePlusIcon,
  GripVerticalIcon,
  SearchIcon,
  Settings2Icon,
  PinOffIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@workspace/ui/components/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import {
  Pagination as PaginationPrimitive,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@workspace/ui/components/pagination"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@workspace/ui/components/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import {
  useDataTable,
  useDataTableContext,
  type DataTableFeatures,
  type DataTableFacetedFilterOption,
} from "../hooks/use-data-table"

type DataTableOptions<TData extends RowData> = Omit<
  TableOptions<DataTableFeatures, TData>,
  "features"
>

export type DataTableProps<TData extends RowData> = DataTableOptions<TData> & {
  className?: string
  showSearch?: boolean
  searchPlaceholder?: string
  isLoading?: boolean
  empty?: React.ReactNode
  renderExpandedRow?: (row: Row<DataTableFeatures, TData>) => React.ReactNode
  /** 操作对象为当前筛选结果中跨页选中的行，与操作栏计数一致。 */
  renderSelectionActions?: (
    rows: Row<DataTableFeatures, TData>[]
  ) => React.ReactNode
}

const DEFAULT_PAGE_SIZE = 10
const PAGE_SIZES = [10, 20, 30, 50, 100] as const

function configureColumns<TData extends RowData>(
  columns: DataTableOptions<TData>["columns"]
): DataTableOptions<TData>["columns"] {
  return columns.map((column) => ({
    ...column,
    // 分组列也从叶子列的选项生成筛选，调用方无需重复指定筛选算法。
    ...("columns" in column && column.columns
      ? { columns: configureColumns(column.columns) }
      : {}),
    ...(column.meta?.facetOptions ? { filterFn: "arrHas" as const } : {}),
  }))
}

function getColumnLabel<TData extends RowData>(
  column: Column<DataTableFeatures, TData, unknown>
) {
  if (column.columnDef.meta?.label) {
    return column.columnDef.meta.label
  }
  if (typeof column.columnDef.header === "string") {
    return column.columnDef.header
  }
  return column.id
}

function DataTable<TData extends RowData>({
  columns,
  data,
  searchPlaceholder,
  showSearch = true,
  className,
  isLoading,
  empty,
  initialState,
  renderSelectionActions,
  renderExpandedRow,
  ...options
}: DataTableProps<TData>) {
  const locale = useUiLocale()
  const configuredColumns = React.useMemo(
    () => configureColumns(columns),
    [columns]
  )
  const table = useDataTable({
    columns: configuredColumns,
    data,
    initialState: {
      pagination: { pageIndex: 0, pageSize: DEFAULT_PAGE_SIZE },
      ...initialState,
    },
    ...options,
    columnResizeDirection: localeMeta[locale].direction,
  })

  return (
    <table.AppTable>
      <div
        data-slot="data-table"
        className={cn("flex flex-col gap-4", className)}
      >
        <DataTableToolbar>
          {table.getFilteredSelectedRowModel().rows.length > 0 ? (
            <DataTableSelectionActions<TData>
              renderActions={renderSelectionActions}
            />
          ) : (
            <>
              {showSearch && (
                <DataTableSearch placeholder={searchPlaceholder} />
              )}
              {table
                .getAllLeafColumns()
                .map((column) =>
                  column.columnDef.meta?.facetOptions ? (
                    <DataTableFacetedFilter
                      key={column.id}
                      column={column}
                      options={column.columnDef.meta.facetOptions}
                    />
                  ) : null
                )}
            </>
          )}
        </DataTableToolbar>
        <DataTableContent
          isLoading={isLoading}
          empty={empty}
          renderExpandedRow={renderExpandedRow}
        />
        <DataTablePagination />
      </div>
    </table.AppTable>
  )
}

function DataTableToolbar({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="data-table-toolbar"
      className={cn("flex flex-wrap items-center gap-2", className)}
      {...props}
    >
      {/* 与搜索框保持同高，切换为选择操作时不改变表格的垂直位置。 */}
      <div className="flex min-h-9 min-w-0 flex-1 flex-wrap items-center gap-2">
        {children}
      </div>
      <DataTableViewOptions />
    </div>
  )
}

function DataTableSearch({
  className,
  placeholder,
  ...props
}: Omit<React.ComponentProps<"input">, "value" | "onChange"> & {
  placeholder?: string
}) {
  const { t } = useTranslation("common")
  const table = useDataTableContext()
  const value = (table.state.globalFilter as string | undefined) ?? ""

  return (
    <InputGroup className={cn("max-w-sm", className)}>
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput
        value={value}
        placeholder={placeholder ?? t("search")}
        aria-label={placeholder ?? t("search")}
        onChange={(event) => table.setGlobalFilter(event.target.value)}
        {...props}
      />
    </InputGroup>
  )
}

function DataTableFacetedFilter<TData extends RowData>({
  column,
  options,
}: {
  column: Column<DataTableFeatures, TData, unknown>
  options: readonly DataTableFacetedFilterOption[]
}) {
  const { t } = useTranslation("common")
  const title = getColumnLabel(column)

  const selectedValues = new Set(
    (column.getFilterValue() as string[] | undefined) ?? []
  )
  const facets = column.getFacetedUniqueValues()

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="h-auto min-h-8 flex-wrap border-dashed"
          />
        }
      >
        <CirclePlusIcon data-icon="inline-start" />
        {title}
        {options
          .filter((option) => selectedValues.has(option.value))
          .map((option) => (
            <Badge key={option.value} variant="secondary">
              {option.label}
            </Badge>
          ))}
      </PopoverTrigger>
      <PopoverContent
        className="w-56 gap-0 p-0"
        align="start"
        aria-label={t("filterColumn", { title: title })}
      >
        <Command>
          <CommandInput
            placeholder={title}
            aria-label={t("searchOptions", { title: title })}
          />
          <CommandList>
            <CommandEmpty>{t("emptyTitle")}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = selectedValues.has(option.value)
                const count = facets.get(option.value)
                const Icon = option.icon

                return (
                  <CommandItem
                    key={option.value}
                    data-checked={isSelected}
                    onSelect={() => {
                      const next = new Set(selectedValues)
                      if (isSelected) {
                        next.delete(option.value)
                      } else {
                        next.add(option.value)
                      }
                      column.setFilterValue(
                        next.size > 0 ? Array.from(next) : undefined
                      )
                    }}
                  >
                    {Icon ? <Icon /> : null}
                    <span className="flex-1">{option.label}</span>
                    {count != null ? (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {count}
                      </span>
                    ) : null}
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {selectedValues.size > 0 ? (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    onSelect={() => column.setFilterValue(undefined)}
                  >
                    {t("clearFilters")}
                  </CommandItem>
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function DataTableViewOptions({ className }: { className?: string }) {
  const { t } = useTranslation("common")
  const table = useDataTableContext()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const columns = [
    ...table.getStartLeafColumns(),
    ...table.getCenterLeafColumns(),
    ...table.getEndLeafColumns(),
  ].filter((column) => column.columnDef.meta?.configurable !== false)

  function moveColumnBefore(sourceId: string, targetId: string) {
    if (sourceId === targetId) return

    const source = columns.find((column) => column.id === sourceId)
    const target = columns.find((column) => column.id === targetId)
    if (!source || !target || source.getIsPinned() !== target.getIsPinned())
      return

    const pinned = source.getIsPinned()
    const regionOrder = columns
      .filter((column) => column.getIsPinned() === pinned)
      .map((column) => column.id)
    const nextRegionOrder = regionOrder.filter((id) => id !== sourceId)
    nextRegionOrder.splice(nextRegionOrder.indexOf(targetId), 0, sourceId)

    // 固定列由各自区域的 pinning 顺序控制；中间区域保留完整列顺序再替换该区域。
    if (pinned) {
      table.setColumnPinning((state) => ({
        ...state,
        [pinned]: nextRegionOrder,
      }))
      return
    }

    table.setColumnOrder((currentOrder) => {
      const order =
        currentOrder.length > 0
          ? currentOrder
          : table.getAllLeafColumns().map((column) => column.id)
      let regionIndex = 0
      return order.map((id) => {
        const column = table.getColumn(id)
        return column && !column.getIsPinned()
          ? nextRegionOrder[regionIndex++]!
          : id
      })
    })
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (over) moveColumnBefore(String(active.id), String(over.id))
  }

  const columnGroups = [
    {
      id: "start",
      label: t("pinnedStart"),
      columns: columns.filter((column) => column.getIsPinned() === "start"),
    },
    {
      id: "center",
      label: t("columns"),
      columns: columns.filter((column) => !column.getIsPinned()),
    },
    {
      id: "end",
      label: t("pinnedEnd"),
      columns: columns.filter((column) => column.getIsPinned() === "end"),
    },
  ].filter((group) => group.columns.length > 0)

  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="outline" size="sm" className={className} />}
      >
        <Settings2Icon data-icon="inline-start" />
        {t("view")}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-96 max-w-[calc(100vw-2rem)]"
        aria-label={t("columnSettings")}
      >
        <p className="text-sm font-medium">{t("columns")}</p>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <div className="max-h-80 space-y-3 overflow-y-auto">
            {columnGroups.map((group) => (
              <div key={group.id} className="space-y-1">
                {columnGroups.length > 1 ? (
                  <p className="px-1 text-xs text-muted-foreground">
                    {group.label}
                  </p>
                ) : null}
                <SortableContext
                  items={group.columns.map((column) => column.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {group.columns.map((column) => (
                    <DataTableColumnSettingsItem
                      key={column.id}
                      column={column}
                    />
                  ))}
                </SortableContext>
              </div>
            ))}
          </div>
        </DndContext>
        <div className="mt-3 border-t pt-3">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => {
              table.resetColumnVisibility()
              table.resetColumnOrder()
              table.resetColumnPinning()
              table.resetColumnSizing()
            }}
          >
            <RotateCcwIcon data-icon="inline-start" />
            {t("resetColumns")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function DataTableColumnSettingsItem({
  column,
}: {
  column: Column<DataTableFeatures, RowData, unknown>
}) {
  const { t } = useTranslation("common")
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.id })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: transform
          ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)`
          : undefined,
        transition,
      }}
      className={cn(
        "flex items-center gap-2 rounded-lg px-1",
        isDragging && "z-10 bg-muted opacity-60 shadow-sm"
      )}
    >
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("reorderColumn", { title: getColumnLabel(column) })}
        {...attributes}
        {...listeners}
      >
        <GripVerticalIcon />
      </Button>
      <Checkbox
        aria-label={t("showColumn", { title: getColumnLabel(column) })}
        checked={column.getIsVisible()}
        disabled={!column.getCanHide()}
        onCheckedChange={(checked) => column.toggleVisibility(checked)}
      />
      <span className="min-w-0 flex-1 truncate text-sm">
        {getColumnLabel(column)}
      </span>
      <Select
        items={{ none: t("unpinned"), start: t("start"), end: t("end") }}
        value={column.getIsPinned() || "none"}
        disabled={!column.getCanPin()}
        onValueChange={(value) => {
          if (value !== null)
            column.pin(value === "none" ? false : (value as "start" | "end"))
        }}
      >
        <SelectTrigger
          size="sm"
          aria-label={t("pinColumn", { title: getColumnLabel(column) })}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{t("unpinned")}</SelectItem>
          <SelectItem value="start">{t("start")}</SelectItem>
          <SelectItem value="end">{t("end")}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

function getColumnStyle<TData extends RowData, TValue>(
  column: Column<DataTableFeatures, TData, TValue>
): React.CSSProperties {
  const pinned = column.getIsPinned()
  return {
    width: column.getSize(),
    position: pinned ? "sticky" : "relative",
    insetInlineStart: pinned === "start" ? column.getStart("start") : undefined,
    insetInlineEnd: pinned === "end" ? column.getAfter("end") : undefined,
    zIndex: pinned ? 10 : undefined,
  }
}

function DataTableContent<TData extends RowData>({
  isLoading,
  empty,
  renderExpandedRow,
}: {
  isLoading?: boolean
  empty?: React.ReactNode
  renderExpandedRow?: DataTableProps<TData>["renderExpandedRow"]
}) {
  const { t } = useTranslation("common")
  const table = useDataTableContext<TData>()
  const rows = [
    ...table.getTopRows(),
    ...table.getCenterRows(),
    ...table.getBottomRows(),
  ]
  const visibleColumns = table.getVisibleLeafColumns()
  const columnCount = visibleColumns.length
  const skeletonRows = table.state.pagination.pageSize

  return (
    <div
      data-slot="data-table-content"
      className="overflow-hidden rounded-2xl border"
    >
      <Table
        aria-busy={!!isLoading}
        className="table-fixed"
        style={{ width: table.getTotalSize() }}
      >
        <colgroup>
          {visibleColumns.map((column) => (
            <col key={column.id} style={{ width: column.getSize() }} />
          ))}
        </colgroup>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const sorted = header.column.getCanSort()
                  ? header.column.getIsSorted()
                  : undefined

                return (
                  <TableHead
                    key={header.id}
                    colSpan={header.colSpan}
                    style={getColumnStyle(header.column)}
                    className="relative bg-background"
                    aria-sort={
                      sorted === "asc"
                        ? "ascending"
                        : sorted === "desc"
                          ? "descending"
                          : sorted === false
                            ? "none"
                            : undefined
                    }
                  >
                    {header.isPlaceholder ? null : (
                      <table.FlexRender header={header} />
                    )}
                    {header.column.getCanResize() && !header.isPlaceholder ? (
                      <div
                        role="separator"
                        aria-label={t("resizeColumn", {
                          title: getColumnLabel(header.column),
                        })}
                        aria-orientation="vertical"
                        aria-valuenow={header.column.getSize()}
                        tabIndex={0}
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        onDoubleClick={() => header.column.resetSize()}
                        onKeyDown={(event) => {
                          if (
                            event.key !== "ArrowLeft" &&
                            event.key !== "ArrowRight"
                          )
                            return
                          event.preventDefault()
                          const delta =
                            (event.key === "ArrowRight" ? 10 : -10) *
                            (table.options.columnResizeDirection === "rtl"
                              ? -1
                              : 1)
                          const {
                            minSize = 20,
                            maxSize = Number.MAX_SAFE_INTEGER,
                          } = header.column.columnDef
                          table.setColumnSizing((sizes) => ({
                            ...sizes,
                            [header.column.id]: Math.max(
                              minSize,
                              Math.min(maxSize, header.column.getSize() + delta)
                            ),
                          }))
                        }}
                        className="absolute inset-y-0 end-0 z-20 w-1 cursor-col-resize touch-none bg-border/50 hover:bg-primary focus-visible:bg-primary"
                      />
                    ) : null}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array.from({ length: skeletonRows }, (_, index) => (
              <TableRow key={index} className="hover:bg-transparent">
                {Array.from({ length: columnCount }, (_, cellIndex) => (
                  <TableCell key={cellIndex}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : rows.length > 0 ? (
            rows.map((row) => (
              <React.Fragment key={row.id}>
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                >
                  {row.getVisibleCells().map((cell) =>
                    (() => {
                      const allowCellOverflow =
                        cell.column.columnDef.meta?.allowCellOverflow === true

                      return (
                        <TableCell
                          key={cell.id}
                          style={getColumnStyle(cell.column)}
                          className={cn(
                            allowCellOverflow
                              ? "overflow-visible"
                              : "overflow-hidden",
                            cell.column.getIsPinned() && "bg-background",
                            row.getIsSelected() &&
                              cell.column.getIsPinned() &&
                              "bg-muted"
                          )}
                        >
                          <div className={cn(!allowCellOverflow && "truncate")}>
                            <table.FlexRender cell={cell} />
                          </div>
                        </TableCell>
                      )
                    })()
                  )}
                </TableRow>
                {row.getIsExpanded() && renderExpandedRow ? (
                  <TableRow>
                    <TableCell
                      colSpan={columnCount}
                      className="bg-muted/30 p-4 whitespace-normal"
                    >
                      {renderExpandedRow(row)}
                    </TableCell>
                  </TableRow>
                ) : null}
              </React.Fragment>
            ))
          ) : (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columnCount}>
                {empty ?? (
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>{t("emptyTitle")}</EmptyTitle>
                      <EmptyDescription>
                        {t("emptyDescription")}
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function DataTableColumnHeader<TData extends RowData, TValue = unknown>({
  header,
  title,
  className,
}: {
  header: Header<DataTableFeatures, TData, TValue>
  title: string
  className?: string
}) {
  if (!header.column.getCanSort()) {
    return <div className={cn("font-medium", className)}>{title}</div>
  }

  return (
    <Subscribe
      source={header.table.atoms.sorting}
      selector={(sorting) =>
        sorting.find((sort) => sort.id === header.column.id)?.desc
      }
    >
      {(desc) => (
        <Button
          variant="ghost"
          size="sm"
          className={cn("-ms-3", className)}
          onClick={header.column.getToggleSortingHandler()}
        >
          {title}
          {desc === true ? (
            <ArrowDownIcon data-icon="inline-end" />
          ) : desc === false ? (
            <ArrowUpIcon data-icon="inline-end" />
          ) : (
            <ChevronsUpDownIcon data-icon="inline-end" />
          )}
        </Button>
      )}
    </Subscribe>
  )
}

function DataTableSelectionActions<TData extends RowData>({
  renderActions,
}: {
  renderActions?: DataTableProps<TData>["renderSelectionActions"]
}) {
  const { t } = useTranslation("common")
  const table = useDataTableContext<TData>()
  // 只操作当前筛选结果中的选中行；翻页不会缩小批量操作的对象集合。
  const locale = useUiLocale()
  const rows = table.getFilteredSelectedRowModel().rows

  if (rows.length === 0) return null

  return (
    <div
      data-slot="data-table-selection-actions"
      role="region"
      aria-label={t("selectionActions")}
      className="flex flex-wrap items-center gap-2"
    >
      <span role="status" className="text-sm font-medium">
        {t("selectedRows", {
          total: createFormatter(locale).number(rows.length),
        })}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => table.resetRowSelection(true)}
      >
        <XIcon data-icon="inline-start" aria-hidden="true" />
        {t("clearSelection")}
      </Button>
      {renderActions ? (
        <div className="flex flex-wrap items-center gap-2 border-s ps-2">
          {renderActions(rows)}
        </div>
      ) : null}
    </div>
  )
}

function DataTablePagination() {
  const table = useDataTableContext()
  return (
    <Pagination
      pageIndex={table.state.pagination.pageIndex}
      pageSize={table.state.pagination.pageSize}
      rowCount={table.getRowCount()}
      pageCount={table.getPageCount()}
      onPageChange={(index) => table.setPageIndex(index)}
      onPageSizeChange={(size) => table.setPageSize(size)}
    />
  )
}

export function Pagination({
  pageSizes = PAGE_SIZES,
  pageIndex,
  pageSize,
  rowCount,
  pageCount,
  onPageChange,
  onPageSizeChange,
}: {
  pageSizes?: readonly number[]
  pageIndex: number
  pageSize: number
  rowCount: number
  pageCount: number
  onPageChange: (pageIndex: number) => void
  onPageSizeChange: (pageSize: number) => void
}) {
  const { t } = useTranslation("common")
  const format = createFormatter(useUiLocale())
  const pageSizeSelectId = React.useId()
  const pageSizeOptions = Object.fromEntries(
    pageSizes.map((size) => [String(size), format.number(size)])
  )
  const paginationItems = getPaginationItems(pageIndex, pageCount)

  return (
    <div
      data-slot="data-table-pagination"
      className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="text-sm text-muted-foreground">
        {t("rows", { total: format.number(rowCount) })}
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:gap-6 lg:gap-8">
        <Field orientation="horizontal" className="w-fit shrink-0">
          <FieldLabel htmlFor={pageSizeSelectId} className="whitespace-nowrap">
            {t("rowsPerPage")}
          </FieldLabel>
          <Select
            items={pageSizeOptions}
            value={String(pageSize)}
            onValueChange={(value) => {
              if (value !== null) onPageSizeChange(Number(value))
            }}
          >
            <SelectTrigger
              id={pageSizeSelectId}
              size="sm"
              className="w-20"
              aria-label={t("rowsPerPage")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
              <SelectGroup>
                {pageSizes.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {format.number(size)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <PaginationPrimitive
          aria-label={t("pagination")}
          className="mx-0 w-auto"
        >
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                aria-label={t("previous")}
                href="#"
                text=""
                disabled={pageIndex <= 0}
                onClick={(event) => {
                  event.preventDefault()
                  onPageChange(pageIndex - 1)
                }}
              />
            </PaginationItem>
            {paginationItems.map((item, index) =>
              item === "ellipsis" ? (
                <PaginationItem key={`ellipsis-${index}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={item}>
                  <PaginationLink
                    href="#"
                    isActive={item === pageIndex}
                    onClick={(event) => {
                      event.preventDefault()
                      onPageChange(item)
                    }}
                  >
                    {format.number(item + 1)}
                  </PaginationLink>
                </PaginationItem>
              )
            )}
            <PaginationItem>
              <PaginationNext
                aria-label={t("next")}
                href="#"
                text=""
                disabled={pageIndex >= pageCount - 1}
                onClick={(event) => {
                  event.preventDefault()
                  onPageChange(pageIndex + 1)
                }}
              />
            </PaginationItem>
          </PaginationContent>
        </PaginationPrimitive>
      </div>
    </div>
  )
}

function getPaginationItems(pageIndex: number, pageCount: number) {
  if (pageCount <= 0) return []
  if (pageCount <= 7)
    return Array.from({ length: pageCount }, (_, index) => index)

  const pages = new Set([
    0,
    pageCount - 1,
    pageIndex - 1,
    pageIndex,
    pageIndex + 1,
  ])
  const sortedPages = Array.from(pages)
    .filter((page) => page >= 0 && page < pageCount)
    .sort((left, right) => left - right)

  const items: Array<number | "ellipsis"> = []
  for (const page of sortedPages) {
    const previous = items.at(-1)
    if (typeof previous === "number" && page - previous > 1) {
      items.push("ellipsis")
    }
    items.push(page)
  }
  return items
}

function DataTableRowControls<TData extends RowData>({
  row,
}: {
  row: Row<DataTableFeatures, TData>
}) {
  const { t } = useTranslation("common")
  return (
    <div className="flex items-center gap-1">
      {row.getCanExpand() ? (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={row.getIsExpanded() ? t("collapseRow") : t("expandRow")}
          aria-expanded={row.getIsExpanded()}
          onClick={() => row.toggleExpanded()}
        >
          <ChevronRightIcon
            className={row.getIsExpanded() ? "rotate-90" : "rtl:rotate-180"}
          />
        </Button>
      ) : null}
      {row.getCanPin() ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button size="icon-sm" variant="ghost" aria-label={t("pinRow")} />
            }
          >
            <Settings2Icon />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => row.pin("top")}>
              <ArrowUpToLineIcon />
              {t("pinTop")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => row.pin("bottom")}>
              <ArrowDownToLineIcon />
              {t("pinBottom")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!row.getIsPinned()}
              onClick={() => row.pin(false)}
            >
              <PinOffIcon />
              {t("unpinRow")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
}

function DataTableSelectAllCheckbox<TData extends RowData>({
  table,
}: {
  table: TanStackTable<DataTableFeatures, TData>
}) {
  const { t } = useTranslation("common")
  return (
    <Subscribe source={table.atoms.rowSelection}>
      {() => {
        const allSelected = table.getIsAllPageRowsSelected()
        const someSelected = table.getIsSomePageRowsSelected()

        return (
          <Checkbox
            checked={allSelected}
            indeterminate={someSelected && !allSelected}
            aria-label={t("selectAll")}
            onCheckedChange={(_checked, details) => {
              table.getToggleAllPageRowsSelectedHandler()(details.event)
            }}
          />
        )
      }}
    </Subscribe>
  )
}

function DataTableSelectRowCheckbox<TData extends RowData>({
  row,
}: {
  row: Row<DataTableFeatures, TData>
}) {
  const { t } = useTranslation("common")
  return (
    <Subscribe
      source={row.table.atoms.rowSelection}
      selector={(selection) => selection[row.id]}
    >
      {(selected) => (
        <Checkbox
          checked={!!selected}
          disabled={!row.getCanSelect()}
          aria-label={t("selectRow")}
          onCheckedChange={(_checked, details) => {
            row.getToggleSelectedHandler()(details.event)
          }}
        />
      )}
    </Subscribe>
  )
}

export {
  DataTable,
  DataTableRowControls,
  DataTableColumnHeader,
  DataTableSelectAllCheckbox,
  DataTableSelectRowCheckbox,
}
