"use client"

import * as React from "react"
import { Tiptap, useEditor, type JSONContent } from "@tiptap/react"
import { cn } from "cn"

import { createRichTextExtensions } from "./extensions"
import { Toolbar } from "./toolbar"
import { FileContentContext, type FileContentPorts } from "./file-context"
import { useImageUploads } from "./use-image-uploads"
import type { UploadImage } from "./insert-image"
import { Button } from "@workspace/ui/components/button"
import { useTranslation } from "react-i18next"

type RichTextEditorBaseProps = FileContentPorts & {
  variant: "field" | "document"
  value: JSONContent
  className?: string
  id?: string
}

export type RichTextEditorProps =
  | (RichTextEditorBaseProps & {
      editable?: true
      onChange: (value: JSONContent) => void
      onUploadImage?: UploadImage
    })
  | (RichTextEditorBaseProps & {
      editable: false
      onChange?: never
      onUploadImage?: never
    })

export type { JSONContent }

const contentTypographyClassName =
  "[&_.tiptap]:outline-none [&_.tiptap]:text-start [&_.tiptap>:first-child]:mt-0 [&_.tiptap_p]:my-2 [&_.tiptap_h1]:mt-4 [&_.tiptap_h1]:mb-2 [&_.tiptap_h1]:text-2xl [&_.tiptap_h1]:font-semibold [&_.tiptap_h2]:mt-4 [&_.tiptap_h2]:mb-2 [&_.tiptap_h2]:text-xl [&_.tiptap_h2]:font-semibold [&_.tiptap_h3]:mt-3 [&_.tiptap_h3]:mb-1.5 [&_.tiptap_h3]:text-lg [&_.tiptap_h3]:font-semibold [&_.tiptap_ul]:my-2 [&_.tiptap_ul]:list-disc [&_.tiptap_ul]:ps-6 [&_.tiptap_ol]:my-2 [&_.tiptap_ol]:list-decimal [&_.tiptap_ol]:ps-6 [&_.tiptap_blockquote]:my-2 [&_.tiptap_blockquote]:border-s-2 [&_.tiptap_blockquote]:border-border [&_.tiptap_blockquote]:ps-4 [&_.tiptap_blockquote]:text-muted-foreground [&_.tiptap_code]:rounded-md [&_.tiptap_code]:bg-muted [&_.tiptap_code]:px-1 [&_.tiptap_code]:py-0.5 [&_.tiptap_code]:font-mono [&_.tiptap_code]:text-sm [&_.tiptap_pre]:my-2 [&_.tiptap_pre]:overflow-x-auto [&_.tiptap_pre]:rounded-xl [&_.tiptap_pre]:bg-muted [&_.tiptap_pre]:p-3 [&_.tiptap_pre_code]:bg-transparent [&_.tiptap_pre_code]:p-0 [&_.tiptap_a]:text-primary [&_.tiptap_a]:underline [&_.tiptap_img]:my-2 [&_.tiptap_img]:max-w-full [&_.tiptap_img]:rounded-xl [&_.tiptap_table]:my-2 [&_.tiptap_table]:w-full [&_.tiptap_table]:border-collapse [&_.tiptap_th]:border [&_.tiptap_th]:border-border [&_.tiptap_th]:bg-muted/50 [&_.tiptap_th]:px-2 [&_.tiptap_th]:py-1 [&_.tiptap_th]:text-start [&_.tiptap_td]:border [&_.tiptap_td]:border-border [&_.tiptap_td]:px-2 [&_.tiptap_td]:py-1"

export function RichTextEditor(props: RichTextEditorProps) {
  const { variant, value, className, id } = props
  const isEditable = props.editable !== false
  const onChangeEvent = React.useEffectEvent((next: JSONContent) => {
    if (props.editable === false) {
      return
    }
    props.onChange(next)
  })
  const { t } = useTranslation("common")
  const enqueueRef = React.useRef<
    ((files: File[], pos?: number) => void) | null
  >(null)
  const canUpload = isEditable && Boolean(props.onUploadImage)
  const onImages = React.useEffectEvent((files: File[], pos?: number) => {
    if (!enqueueRef.current)
      throw new Error("Editor upload handler is not ready")
    enqueueRef.current(files, pos)
  })

  const editor = useEditor(
    {
      editable: isEditable,
      content: value,
      extensions: createRichTextExtensions({
        onImages: canUpload ? onImages : undefined,
      }),
      editorProps: {
        attributes: id ? { id } : {},
      },
      onUpdate: ({ editor: current }) => {
        onChangeEvent(current.getJSON())
      },
    },
    [isEditable, canUpload]
  )
  const uploads = useImageUploads(editor, {
    contentScopeKey: props.contentScopeKey,
    onUploadImage: isEditable ? props.onUploadImage : undefined,
    getFileErrorMessage: props.getFileErrorMessage,
  })
  React.useEffect(() => {
    enqueueRef.current = uploads.enqueue
  }, [uploads.enqueue])
  function uploadLabel(item: (typeof uploads.items)[number]) {
    const name = item.file.name
    switch (item.status) {
      case "queued":
        return t("imageUploadQueued", { name })
      case "transmitting":
        return t("imageUploadTransmitting", { name })
      case "saving":
        return t("imageUploadSaving", { name })
      case "confirming":
        return t("imageUploadConfirming", { name })
      case "complete":
        return t("imageUploadComplete", { name })
      case "failed":
        return t("imageUploadFailed", { name, reason: item.error! })
      case "stopped":
        return t("imageUploadCancelled", { name })
    }
  }

  React.useEffect(() => {
    if (JSON.stringify(editor.getJSON()) === JSON.stringify(value)) {
      return
    }
    editor.commands.setContent(value, { emitUpdate: false })
  }, [editor, value])

  return (
    <div
      data-slot="rich-text-editor"
      data-variant={variant}
      className={cn(
        "w-full overflow-hidden rounded-4xl border border-input bg-input/30 text-base transition-colors outline-none focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 md:text-sm",
        contentTypographyClassName,
        className
      )}
    >
      <FileContentContext value={props}>
        <Tiptap editor={editor}>
          {props.editable === false ? null : (
            <Toolbar
              density={variant}
              onImages={canUpload ? uploads.enqueue : undefined}
            />
          )}
          {uploads.items.length > 0 && (
            <ul
              className="space-y-2 border-b p-3 text-sm"
              aria-label={t("imageUploads")}
            >
              {uploads.items.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-2">
                  <span
                    className="min-w-0 break-words"
                    role={item.status === "failed" ? "alert" : "status"}
                  >
                    {uploadLabel(item)}
                  </span>
                  {item.status === "failed" && canUpload && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => uploads.retry(item.id)}
                    >
                      {t("retryUpload")}
                    </Button>
                  )}
                  {["queued", "transmitting", "saving", "confirming"].includes(
                    item.status
                  ) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => uploads.stop(item.id)}
                    >
                      {t("cancelUpload")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Tiptap.Content
            className={
              variant === "field" ? "min-h-16 px-3 py-2" : "min-h-96 px-8 py-6"
            }
          />
        </Tiptap>
      </FileContentContext>
    </div>
  )
}
