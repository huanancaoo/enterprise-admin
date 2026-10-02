import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import type { RichTextEditorProps } from "@workspace/admin"
import {
  FileVersionReferenceSchema,
  type FolderResponse,
} from "@workspace/contracts"
import { useUploadQueue } from "../files/use-upload-queue"
import { uploadRecordKey } from "../files/upload-records"
import { fileKeys } from "../files/file-queries"
import type { ProjectFilePorts } from "./project-content-ports"
import { ProjectFileEditorError } from "./project-file-editor-errors"

type UploadImage = NonNullable<RichTextEditorProps["onUploadImage"]>
type Waiting = {
  resolve: (value: Awaited<ReturnType<UploadImage>>) => void
  reject: (reason: unknown) => void
  options: Parameters<UploadImage>[1]
}
const records = {
  getItem: (key: string) => localStorage.getItem(key + ":project-editor"),
  setItem: (key: string, value: string) =>
    localStorage.setItem(key + ":project-editor", value),
}

export function useProjectImageUploads({
  userId,
  organizationId,
  canUpload,
  ports,
}: {
  userId: string
  organizationId: string
  canUpload: boolean
  ports: ProjectFilePorts
}) {
  const { t } = useTranslation(["projects", "common"])
  const client = useQueryClient()
  const waiting = useRef(new Map<string, Waiting>())
  const [active, setActive] = useState<string[]>([])
  const queue = useUploadQueue({
    userId,
    organizationId,
    storage: records,
    canUpload,
    canOverwrite: false,
    upload: (fields, file, queueSignal) => {
      const imageSignal = waiting.current.get(fields.operationId)?.options
        .signal
      const signal = imageSignal
        ? AbortSignal.any([queueSignal, imageSignal])
        : queueSignal
      signal.throwIfAborted()
      return ports.upload(fields, file, signal)
    },
    overwrite: () => {
      throw new Error("Project editor only creates files")
    },
    readOperation: ports.operation,
    onCompleted: () => {
      void client.invalidateQueries({
        queryKey: fileKeys.scope(organizationId),
      })
    },
  })
  useEffect(() => {
    for (const job of queue.jobs) {
      const pending = waiting.current.get(job.id)
      if (!pending) continue
      if (job.status === "completed") {
        if (!pending.options.signal.aborted) {
          const result = FileVersionReferenceSchema.safeParse({
            fileId: job.result?.entryId,
            versionId: job.result?.versionId,
          })
          if (result.success) pending.resolve(result.data)
          else pending.reject(new Error(t("common:operationFailed")))
        }
        waiting.current.delete(job.id)
      } else if (job.status === "failed") {
        pending.reject(
          new ProjectFileEditorError(job.error ?? t("common:operationFailed"))
        )
        waiting.current.delete(job.id)
      } else if (!pending.options.signal.aborted) {
        if (job.status === "submitting") pending.options.onStage("transmitting")
        else if (job.status === "unconfirmed")
          pending.options.onStage("confirming")
        else if (
          ["pending", "preparing", "committed", "cleaning"].includes(job.status)
        )
          pending.options.onStage("saving")
      }
    }
  }, [queue.jobs, t])
  useEffect(() => {
    const pending = waiting.current
    return () => {
      for (const item of pending.values())
        item.reject(new DOMException("Editor scope changed", "AbortError"))
      pending.clear()
    }
  }, [])
  const uploadImage =
    (parent: FolderResponse | null): UploadImage =>
    (file, options) => {
      options.signal.throwIfAborted()
      if (!parent)
        return Promise.reject(
          new ProjectFileEditorError(t("projects:contentChooseUploadFolder"))
        )
      let operationId: string | undefined
      let abort: (() => void) | undefined
      const result = new Promise<Awaited<ReturnType<UploadImage>>>(
        (resolve, reject) => {
          const ids = queue.enqueue({ kind: "upload", parent }, [
            { file, name: file.name },
          ])
          const id = ids?.[0]
          if (!id) {
            reject(new Error(t("common:operationFailed")))
            return
          }
          operationId = id
          waiting.current.set(id, { resolve, reject, options })
          setActive((previous) => [...previous, id])
          // 取消只中止此次字节传输和节点插入；未知提交结果仍由原操作记录查询，不删除文件库对象。
          abort = () => reject(options.signal.reason)
          options.signal.addEventListener("abort", abort, { once: true })
        }
      )
      return result.finally(() => {
        if (abort) options.signal.removeEventListener("abort", abort)
        setActive((previous) => previous.filter((id) => id !== operationId))
      })
    }
  return {
    queue,
    uploadImage,
    uploading: active.length > 0,
    recordKey: uploadRecordKey(userId, organizationId) + ":project-editor",
  }
}
