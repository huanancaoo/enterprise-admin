"use client"

import { useTranslation } from "react-i18next"
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
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import type { Column, RowData } from "@tanstack/react-table"
import { cn } from "cn"
import { GripVerticalIcon, Settings2Icon, RotateCcwIcon } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@workspace/ui/components/select"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  useDataTableContext,
  type DataTableFeatures,
} from "../../hooks/use-data-table"
import { getColumnLabel } from "../../lib/data-table-columns"
import { useDataTablePresentation } from "./presentation"

export function DataTableViewOptions({ className }: { className?: string }) {
  const { t } = useTranslation("common")
  const table = useDataTableContext()
  const { isActionPending } = useDataTablePresentation()
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
    const nextOrder = arrayMove(
      regionOrder,
      regionOrder.indexOf(sourceId),
      regionOrder.indexOf(targetId)
    )
    const configurableIds = new Set(regionOrder)
    let index = 0
    // 控制列不参与拖动，但始终占据原来的位置；固定区域也保留这些列的 pinning。
    const fullOrder = pinned
      ? table.state.columnPinning[pinned]
      : table.getAllLeafColumns().map((column) => column.id)
    const reordered = fullOrder.map((id) =>
      configurableIds.has(id) ? nextOrder[index++]! : id
    )
    if (pinned) {
      table.setColumnPinning((state) => ({ ...state, [pinned]: reordered }))
    } else {
      table.setColumnOrder(reordered)
    }
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
        render={
          <Button
            variant="outline"
            disabled={isActionPending}
            size="sm"
            className={className}
          />
        }
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
            disabled={isActionPending}
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
  const { isActionPending } = useDataTablePresentation()
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.id, disabled: isActionPending })

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
        disabled={isActionPending}
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
        disabled={isActionPending || !column.getCanHide()}
        onCheckedChange={(checked) => column.toggleVisibility(checked)}
      />
      <span className="min-w-0 flex-1 truncate text-sm">
        {getColumnLabel(column)}
      </span>
      <Select
        items={{ none: t("unpinned"), start: t("start"), end: t("end") }}
        value={column.getIsPinned() || "none"}
        disabled={isActionPending || !column.getCanPin()}
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
