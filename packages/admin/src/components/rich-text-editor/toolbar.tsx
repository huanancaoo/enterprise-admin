"use client"

import * as React from "react"
import { useTiptap, useTiptapState } from "@tiptap/react"
import { cn } from "cn"
import {
  BetweenHorizontalStartIcon,
  BetweenVerticalStartIcon,
  BoldIcon,
  CodeIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ImageIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  QuoteIcon,
  SquareCodeIcon,
  StrikethroughIcon,
  TableColumnsSplitIcon,
  TableIcon,
  TableRowsSplitIcon,
  Trash2Icon,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { Separator } from "@workspace/ui/components/separator"
import { Toggle } from "@workspace/ui/components/toggle"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

import { IMAGE_ACCEPT, insertUploadedImages } from "./insert-image"

type ToolbarProps = {
  density: "field" | "document"
  onUploadImage: (file: File) => Promise<string>
}

type ToolbarState = {
  bold: boolean
  italic: boolean
  strike: boolean
  heading: "1" | "2" | "3" | null
  bulletList: boolean
  orderedList: boolean
  blockquote: boolean
  code: boolean
  codeBlock: boolean
  link: boolean
  table: boolean
}

function sameToolbarState(a: ToolbarState, b: ToolbarState | null) {
  if (!b) {
    return false
  }
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.strike === b.strike &&
    a.heading === b.heading &&
    a.bulletList === b.bulletList &&
    a.orderedList === b.orderedList &&
    a.blockquote === b.blockquote &&
    a.code === b.code &&
    a.codeBlock === b.codeBlock &&
    a.link === b.link &&
    a.table === b.table
  )
}

function ToolbarGroup({ children }: { children: React.ReactNode }) {
  return (
    <div role="group" className="flex items-center gap-0.5">
      {children}
    </div>
  )
}

function ToolbarSeparator() {
  return (
    <Separator
      orientation="vertical"
      className="mx-0.5 data-vertical:h-4 data-vertical:self-auto"
    />
  )
}

function ToolbarToggle({
  label,
  pressed,
  size,
  className,
  onPressedChange,
  children,
}: {
  label: string
  pressed: boolean
  size: "sm" | "default"
  className?: string
  onPressedChange: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            type="button"
            size={size}
            pressed={pressed}
            aria-label={label}
            className={className}
            onPressedChange={onPressedChange}
          >
            {children}
          </Toggle>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function ToolbarIconButton({
  label,
  size,
  disabled,
  onClick,
  children,
}: {
  label: string
  size: "icon-sm" | "icon"
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size={size}
            disabled={disabled}
            aria-label={label}
            onClick={onClick}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function Toolbar({ density, onUploadImage }: ToolbarProps) {
  const { editor } = useTiptap()
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [linkOpen, setLinkOpen] = React.useState(false)
  const [href, setHref] = React.useState("")
  const toggleSize = density === "field" ? "sm" : "default"
  const toggleClassName =
    density === "field" ? "size-8 min-w-8 p-0" : "size-9 min-w-9 p-0"
  const buttonSize = density === "field" ? "icon-sm" : "icon"
  const state = useTiptapState((snapshot): ToolbarState => {
    const current = snapshot.editor
    return {
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      strike: current.isActive("strike"),
      heading: current.isActive("heading", { level: 1 })
        ? "1"
        : current.isActive("heading", { level: 2 })
          ? "2"
          : current.isActive("heading", { level: 3 })
            ? "3"
            : null,
      bulletList: current.isActive("bulletList"),
      orderedList: current.isActive("orderedList"),
      blockquote: current.isActive("blockquote"),
      code: current.isActive("code"),
      codeBlock: current.isActive("codeBlock"),
      link: current.isActive("link"),
      table: current.isActive("table"),
    }
  }, sameToolbarState)

  function applyLink() {
    const next = href.trim()
    if (!next) {
      editor.chain().focus().unsetLink().run()
    } else {
      editor.chain().focus().setLink({ href: next }).run()
    }
    setLinkOpen(false)
  }

  return (
    <TooltipProvider>
      <div
        role="toolbar"
        aria-label="Formatting"
        data-slot="rich-text-editor-toolbar"
        className={cn(
          "flex flex-wrap items-center border-b border-input",
          density === "field" ? "gap-0.5 p-1" : "gap-1 p-1.5"
        )}
        onMouseDown={(event) => {
          // 工具栏 mousedown 会抢走 contenteditable 选区，命令就会打到错误位置
          event.preventDefault()
        }}
      >
        <ToolbarGroup>
          <ToolbarToggle
            label="Bold"
            size={toggleSize}
            className={toggleClassName}
            pressed={state.bold}
            onPressedChange={() => editor.chain().focus().toggleBold().run()}
          >
            <BoldIcon />
          </ToolbarToggle>
          <ToolbarToggle
            label="Italic"
            size={toggleSize}
            className={toggleClassName}
            pressed={state.italic}
            onPressedChange={() => editor.chain().focus().toggleItalic().run()}
          >
            <ItalicIcon />
          </ToolbarToggle>
          <ToolbarToggle
            label="Strikethrough"
            size={toggleSize}
            className={toggleClassName}
            pressed={state.strike}
            onPressedChange={() => editor.chain().focus().toggleStrike().run()}
          >
            <StrikethroughIcon />
          </ToolbarToggle>
        </ToolbarGroup>
        <ToolbarSeparator />
        <ToolbarGroup>
          <ToggleGroup
            size={toggleSize}
            value={state.heading ? [state.heading] : []}
            onValueChange={(value) => {
              const level = value[0]
              if (!level) {
                editor.chain().focus().setParagraph().run()
                return
              }
              editor
                .chain()
                .focus()
                .toggleHeading({ level: Number(level) as 1 | 2 | 3 })
                .run()
            }}
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <ToggleGroupItem
                    type="button"
                    value="1"
                    aria-label="Heading 1"
                    className={toggleClassName}
                  >
                    <Heading1Icon />
                  </ToggleGroupItem>
                }
              />
              <TooltipContent>Heading 1</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <ToggleGroupItem
                    type="button"
                    value="2"
                    aria-label="Heading 2"
                    className={toggleClassName}
                  >
                    <Heading2Icon />
                  </ToggleGroupItem>
                }
              />
              <TooltipContent>Heading 2</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <ToggleGroupItem
                    type="button"
                    value="3"
                    aria-label="Heading 3"
                    className={toggleClassName}
                  >
                    <Heading3Icon />
                  </ToggleGroupItem>
                }
              />
              <TooltipContent>Heading 3</TooltipContent>
            </Tooltip>
          </ToggleGroup>
        </ToolbarGroup>
        <ToolbarSeparator />
        <ToolbarGroup>
          <ToolbarToggle
            label="Bullet list"
            size={toggleSize}
            className={toggleClassName}
            pressed={state.bulletList}
            onPressedChange={() =>
              editor.chain().focus().toggleBulletList().run()
            }
          >
            <ListIcon />
          </ToolbarToggle>
          <ToolbarToggle
            label="Ordered list"
            size={toggleSize}
            className={toggleClassName}
            pressed={state.orderedList}
            onPressedChange={() =>
              editor.chain().focus().toggleOrderedList().run()
            }
          >
            <ListOrderedIcon />
          </ToolbarToggle>
        </ToolbarGroup>
        <ToolbarSeparator />
        <ToolbarGroup>
          <ToolbarToggle
            label="Blockquote"
            size={toggleSize}
            className={toggleClassName}
            pressed={state.blockquote}
            onPressedChange={() =>
              editor.chain().focus().toggleBlockquote().run()
            }
          >
            <QuoteIcon />
          </ToolbarToggle>
          <ToolbarToggle
            label="Inline code"
            size={toggleSize}
            className={toggleClassName}
            pressed={state.code}
            onPressedChange={() => editor.chain().focus().toggleCode().run()}
          >
            <CodeIcon />
          </ToolbarToggle>
          <ToolbarToggle
            label="Code block"
            size={toggleSize}
            className={toggleClassName}
            pressed={state.codeBlock}
            onPressedChange={() =>
              editor.chain().focus().toggleCodeBlock().run()
            }
          >
            <SquareCodeIcon />
          </ToolbarToggle>
        </ToolbarGroup>
        <ToolbarSeparator />
        <ToolbarGroup>
          <Popover
            open={linkOpen}
            onOpenChange={(open) => {
              setLinkOpen(open)
              if (open) {
                setHref(String(editor.getAttributes("link").href ?? ""))
              }
            }}
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <PopoverTrigger
                    render={
                      <Toggle
                        type="button"
                        size={toggleSize}
                        pressed={state.link}
                        aria-label="Link"
                        className={toggleClassName}
                        onPressedChange={() => {
                          // pressed 只反映文档里是否已有 link，打开弹层不能改 mark
                        }}
                      >
                        <LinkIcon />
                      </Toggle>
                    }
                  />
                }
              />
              <TooltipContent>Link</TooltipContent>
            </Tooltip>
            <PopoverContent align="start" className="w-72">
              <PopoverHeader>
                <PopoverTitle>Link</PopoverTitle>
              </PopoverHeader>
              <Input
                autoFocus
                value={href}
                placeholder="https://"
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => setHref(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    applyLink()
                  }
                }}
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!state.link && !href.trim()}
                  onClick={() => {
                    editor.chain().focus().unsetLink().run()
                    setLinkOpen(false)
                  }}
                >
                  Remove
                </Button>
                <Button type="button" size="sm" onClick={applyLink}>
                  Apply
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <ToolbarIconButton
            label="Image"
            size={buttonSize}
            onClick={() => fileInputRef.current?.click()}
          >
            <ImageIcon />
          </ToolbarIconButton>
          <input
            ref={fileInputRef}
            type="file"
            accept={IMAGE_ACCEPT}
            multiple
            className="hidden"
            tabIndex={-1}
            onChange={(event) => {
              const files = [...(event.target.files ?? [])]
              event.target.value = ""
              void insertUploadedImages(editor, files, onUploadImage)
            }}
          />
        </ToolbarGroup>
        <ToolbarSeparator />
        <ToolbarGroup>
          <ToolbarIconButton
            label="Insert table"
            size={buttonSize}
            onClick={() =>
              editor
                .chain()
                .focus()
                .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                .run()
            }
          >
            <TableIcon />
          </ToolbarIconButton>
          {state.table ? (
            <>
              <ToolbarIconButton
                label="Add column"
                size={buttonSize}
                onClick={() => editor.chain().focus().addColumnAfter().run()}
              >
                <BetweenVerticalStartIcon />
              </ToolbarIconButton>
              <ToolbarIconButton
                label="Add row"
                size={buttonSize}
                onClick={() => editor.chain().focus().addRowAfter().run()}
              >
                <BetweenHorizontalStartIcon />
              </ToolbarIconButton>
              <ToolbarIconButton
                label="Delete column"
                size={buttonSize}
                onClick={() => editor.chain().focus().deleteColumn().run()}
              >
                <TableColumnsSplitIcon />
              </ToolbarIconButton>
              <ToolbarIconButton
                label="Delete row"
                size={buttonSize}
                onClick={() => editor.chain().focus().deleteRow().run()}
              >
                <TableRowsSplitIcon />
              </ToolbarIconButton>
              <ToolbarIconButton
                label="Delete table"
                size={buttonSize}
                onClick={() => editor.chain().focus().deleteTable().run()}
              >
                <Trash2Icon />
              </ToolbarIconButton>
            </>
          ) : null}
        </ToolbarGroup>
      </div>
    </TooltipProvider>
  )
}
