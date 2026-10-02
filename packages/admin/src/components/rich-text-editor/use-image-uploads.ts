import * as React from "react"
import type { Editor, EditorEvents } from "@tiptap/react"
import { TextSelection, type SelectionBookmark } from "@tiptap/pm/state"
import {
  insertFileImage,
  isAllowedImage,
  type ImageUploadStage,
  type UploadImage,
} from "./insert-image"

type UploadStatus =
  ImageUploadStage | "queued" | "complete" | "failed" | "stopped"
type UploadTask = {
  id: string
  scopeKey: string
  file: File
  status: UploadStatus
  bookmark: SelectionBookmark
  controller?: AbortController
  error?: string
}

export type ImageUploadItem = Pick<
  UploadTask,
  "id" | "file" | "status" | "error" | "scopeKey"
>

type Options = {
  contentScopeKey: string
  onUploadImage?: UploadImage
  getFileErrorMessage: (error: unknown) => string
}

export function useImageUploads(editor: Editor, options: Options) {
  const latest = React.useRef(options)
  React.useEffect(() => {
    latest.current = options
  })
  const tasks = React.useRef(new Map<string, UploadTask>())
  const [items, setItems] = React.useState<ImageUploadItem[]>([])
  const publish = React.useCallback(() => {
    setItems(
      [...tasks.current.values()].map(
        ({ id, file, status, error, scopeKey }) => ({
          id,
          file,
          status,
          error,
          scopeKey,
        })
      )
    )
  }, [])
  const start = React.useCallback(
    async (task: UploadTask) => {
      const { onUploadImage, getFileErrorMessage } = latest.current
      if (!onUploadImage) throw new Error("Image upload capability is required")
      const controller = new AbortController()
      task.controller = controller
      task.error = undefined
      task.status = "queued"
      publish()
      try {
        // 此 Promise 由应用的操作收据确认最终发布，未知结果不能作为终态失败重提。
        const reference = await onUploadImage(task.file, {
          signal: controller.signal,
          onStage: (stage) => {
            if (controller.signal.aborted) return
            task.status = stage
            publish()
          },
        })
        if (controller.signal.aborted || editor.isDestroyed) return
        const position = task.bookmark.resolve(editor.state.doc).from
        insertFileImage(editor, reference, task.file.name, position)
        task.status = "complete"
      } catch (error) {
        if (controller.signal.aborted) return
        task.status = "failed"
        task.error = getFileErrorMessage(error)
      } finally {
        if (task.controller === controller) task.controller = undefined
        publish()
      }
    },
    [editor, publish]
  )

  const enqueue = React.useCallback(
    (files: File[], pos?: number) => {
      const scopeKey = latest.current.contentScopeKey
      for (const file of files.filter(isAllowedImage)) {
        const bookmark =
          pos === undefined
            ? editor.state.selection.getBookmark()
            : TextSelection.create(editor.state.doc, pos).getBookmark()
        const task: UploadTask = {
          id: crypto.randomUUID(),
          scopeKey,
          file,
          bookmark,
          status: "queued",
        }
        tasks.current.set(task.id, task)
        void start(task)
      }
    },
    [editor, start]
  )

  React.useEffect(() => {
    const currentTasks = tasks.current
    const mapPositions = ({ transaction }: EditorEvents["transaction"]) => {
      for (const task of currentTasks.values()) {
        if (task.status !== "complete")
          task.bookmark = task.bookmark.map(transaction.mapping)
      }
    }
    editor.on("transaction", mapPositions)
    return () => {
      editor.off("transaction", mapPositions)
      for (const task of currentTasks.values()) task.controller?.abort()
    }
  }, [editor])

  React.useEffect(() => {
    const scopeKey = options.contentScopeKey
    const currentTasks = tasks.current
    return () => {
      for (const task of currentTasks.values()) {
        if (task.scopeKey === scopeKey) {
          task.controller?.abort()
          currentTasks.delete(task.id)
        }
      }
    }
  }, [options.contentScopeKey])

  return {
    items: items.filter((item) => item.scopeKey === options.contentScopeKey),
    enqueue,
    retry: (id: string) => {
      const task = tasks.current.get(id)
      if (task && task.status === "failed") void start(task)
    },
    stop: (id: string) => {
      const task = tasks.current.get(id)
      if (!task?.controller) return
      task.controller.abort()
      task.status = "stopped"
      publish()
    },
  }
}
