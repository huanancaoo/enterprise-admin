import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ApiClientError } from "@workspace/api-client"
import {
  OverwriteFileFieldsSchema,
  UploadFileFieldsSchema,
  type FileOperationResponse,
  type FileResponse,
  type FolderResponse,
  type OverwriteFileFields,
  type UploadFileFields,
} from "@workspace/contracts"
import { fileRequestErrorMessage } from "./file-queries"
import {
  readUploadRecords,
  saveUploadRecords,
  uploadRecordKey,
  type FileUploadRecord,
} from "./upload-records"
import type { FileUploadJobView } from "./upload-queue"
import type { FileUploadSelection } from "./upload-selection-dialog"

export type FileUploadTarget =
  | { kind: "upload"; parent: FolderResponse }
  | { kind: "overwrite"; target: FileResponse }
export type FileUploadDraft = FileUploadTarget & FileUploadSelection

type Job = FileUploadJobView & {
  record: FileUploadRecord
  draft?: FileUploadDraft
  watch: boolean
}
type UploadQueueOptions = {
  userId: string
  organizationId: string
  storage: Storage
  canUpload: boolean
  canOverwrite: boolean
  upload: (
    fields: UploadFileFields,
    file: File,
    signal: AbortSignal
  ) => Promise<FileOperationResponse>
  overwrite: (
    fileId: string,
    fields: OverwriteFileFields,
    file: File,
    signal: AbortSignal
  ) => Promise<FileOperationResponse>
  readOperation: (
    id: string,
    signal: AbortSignal
  ) => Promise<FileOperationResponse>
  onCompleted: (operation: FileOperationResponse) => void
}

function restore(record: FileUploadRecord): Job {
  return {
    id: record.id,
    action: record.action,
    createdAt: record.createdAt,
    record,
    status: record.submitted ? "unconfirmed" : "needs-file",
    watch: record.submitted,
    canRetry: false,
    hasFile: false,
    isChecking: false,
  }
}

export function useUploadQueue(options: UploadQueueOptions) {
  const { t } = useTranslation(["files", "errors", "common"])
  const key = uploadRecordKey(options.userId, options.organizationId)
  const [initial] = useState(() => {
    try {
      return {
        jobs: readUploadRecords(options.storage, key).map(restore),
        error: false,
      }
    } catch {
      return { jobs: [] as Job[], error: true }
    }
  })
  const [jobs, setJobs] = useState(initial.jobs)
  const current = useRef(initial.jobs)
  const [recordError, setRecordError] = useState(initial.error)
  const [ready, setReady] = useState(!initial.error)
  const ports = useRef(options)
  const active = useRef<AbortController | null>(null)
  const readers = useRef(new Map<string, AbortController>())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const live = useRef(true)
  const completed = useRef(new Set<string>())
  useEffect(() => {
    ports.current = options
  }, [options])
  useEffect(() => {
    live.current = true
    current.current = initial.jobs
    const requests = readers.current
    const scheduled = timers.current
    return () => {
      live.current = false
      active.current?.abort()
      for (const reader of requests.values()) reader.abort()
      for (const timer of scheduled.values()) clearTimeout(timer)
      requests.clear()
      scheduled.clear()
      // 授权范围卸载后释放原 File；持久记录只有操作身份，不能把旧组织草稿带入新范围。
      current.current = []
    }
  }, [initial.jobs])
  const replace = useCallback((next: Job[]) => {
    current.current = next
    setJobs(next)
  }, [])
  const save = useCallback(
    (next: Job[]) =>
      saveUploadRecords(
        options.storage,
        key,
        next.map((job) => job.record)
      ),
    [key, options.storage]
  )
  const update = useCallback(
    (id: string, patch: Partial<Job>) => {
      const next = current.current.map((job) =>
        job.id === id ? { ...job, ...patch } : job
      )
      try {
        save(next)
        setRecordError(false)
      } catch {
        // 写入结果已由服务端确认时，本机记录失败不能把已保存的文件改判为失败。
        setRecordError(true)
      }
      replace(next)
    },
    [replace, save]
  )
  const accept = useCallback(
    (operation: FileOperationResponse) => {
      const job = current.current.find((value) => value.id === operation.id)
      if (!job) return
      const terminal =
        operation.phase === "completed" || operation.phase === "failed"
      update(job.id, {
        status: operation.phase,
        ...(operation.phase === "completed"
          ? { draft: undefined, hasFile: false }
          : {}),
        result: operation.result,
        error: operation.errorCode
          ? t(`errors:${operation.errorCode}`)
          : undefined,
        isChecking: false,
        watch: !terminal,
        record: {
          ...job.record,
          phase: operation.phase,
          updatedAt: operation.updatedAt,
        },
      })
      if (operation.phase === "completed" && !completed.current.has(job.id)) {
        completed.current.add(job.id)
        ports.current.onCompleted(operation)
      }
    },
    [t, update]
  )
  const check = useCallback(
    async (id: string) => {
      if (readers.current.has(id) || !live.current) return
      const job = current.current.find((value) => value.id === id)
      if (!job?.record.submitted) return
      const controller = new AbortController()
      readers.current.set(id, controller)
      update(id, { isChecking: true, watch: true })
      try {
        const operation = await ports.current.readOperation(
          id,
          controller.signal
        )
        if (!controller.signal.aborted) {
          accept(operation)
          if (operation.phase !== "completed" && operation.phase !== "failed") {
            timers.current.set(
              id,
              setTimeout(() => {
                timers.current.delete(id)
                if (live.current) replace([...current.current])
              }, 1500)
            )
          }
        }
      } catch (error) {
        if (!controller.signal.aborted)
          update(id, {
            isChecking: false,
            watch: false,
            error: fileRequestErrorMessage(
              error,
              t("files:uploadStatusUnavailable")
            ),
          })
      } finally {
        readers.current.delete(id)
      }
    },
    [accept, replace, t, update]
  )
  useEffect(() => {
    for (const job of jobs)
      if (
        job.watch &&
        !readers.current.has(job.id) &&
        !timers.current.has(job.id)
      )
        void check(job.id)
  }, [check, jobs])

  useEffect(() => {
    const job = jobs.find((value) => value.status === "queued")
    if (!job?.draft || active.current) return
    const controller = new AbortController()
    active.current = controller
    void (async () => {
      const draft = job.draft!
      let submitted = false
      try {
        update(job.id, { status: "hashing" })
        // 串行处理原 File，避免多文件同时读取 100 MiB 内容；指纹与发送的文件来自同一对象。
        const digest = await crypto.subtle.digest(
          "SHA-256",
          await draft.file.arrayBuffer()
        )
        if (controller.signal.aborted) return
        const contentSha256 = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0")
        ).join("")
        const fields =
          draft.kind === "upload"
            ? UploadFileFieldsSchema.parse({
                operationId: job.id,
                parentId: draft.parent.id,
                name: draft.name,
                declaredBytes: draft.file.size,
                contentSha256,
              })
            : OverwriteFileFieldsSchema.parse({
                operationId: job.id,
                expectedRevision: draft.target.revision,
                declaredBytes: draft.file.size,
                contentSha256,
              })
        const next = current.current.map((value) =>
          value.id === job.id
            ? {
                ...value,
                status: "submitting" as const,
                record: {
                  ...value.record,
                  submitted: true,
                  phase: "unconfirmed" as const,
                  updatedAt: new Date().toISOString(),
                },
              }
            : value
        )
        // 请求发出前必须留下可找回的 UUID；刷新在这个边界之后只查询事实，绝不自动重发。
        save(next)
        replace(next)
        submitted = true
        const operation =
          draft.kind === "upload"
            ? await ports.current.upload(
                fields as UploadFileFields,
                draft.file,
                controller.signal
              )
            : await ports.current.overwrite(
                draft.target.id,
                fields as OverwriteFileFields,
                draft.file,
                controller.signal
              )
        if (!controller.signal.aborted) accept(operation)
      } catch (error) {
        if (controller.signal.aborted) return
        const knownFailure =
          !submitted || (error instanceof ApiClientError && error.status < 500)
        const latest = current.current.find((value) => value.id === job.id)!
        update(job.id, {
          status: knownFailure ? "failed" : "unconfirmed",
          watch: !knownFailure,
          error: fileRequestErrorMessage(
            error,
            t(
              knownFailure
                ? "common:operationFailed"
                : "files:uploadUnconfirmed"
            )
          ),
          record: {
            ...latest.record,
            phase: knownFailure ? "failed" : "unconfirmed",
            updatedAt: new Date().toISOString(),
          },
        })
      } finally {
        active.current = null
        if (live.current) replace([...current.current])
      }
    })()
  }, [accept, jobs, replace, save, t, update])

  const enqueue = (target: FileUploadTarget, items: FileUploadSelection[]) => {
    if (
      !ready ||
      (target.kind === "upload" ? !options.canUpload : !options.canOverwrite)
    )
      throw new Error(t("files:uploadQueueUnavailable"))
    const now = new Date().toISOString()
    const added: Job[] = items.map((item) => {
      const record: FileUploadRecord = {
        id: crypto.randomUUID(),
        action: target.kind,
        phase: "queued",
        submitted: false,
        createdAt: now,
        updatedAt: now,
      }
      return {
        id: record.id,
        action: record.action,
        createdAt: now,
        record,
        draft: { ...target, ...item },
        name: item.name,
        bytes: item.file.size,
        status: "queued",
        watch: false,
        hasFile: true,
        canRetry: false,
        isChecking: false,
      }
    })
    const next = [...current.current, ...added]
    save(next)
    setRecordError(false)
    replace(next)
  }
  const dismiss = (id: string) => {
    const job = current.current.find((value) => value.id === id)
    if (!job || !["failed", "completed", "needs-file"].includes(job.status))
      return
    const next = current.current.filter((value) => value.id !== id)
    try {
      save(next)
      setRecordError(false)
      replace(next)
    } catch {
      setRecordError(true)
    }
  }
  return {
    jobs: jobs.map((job): FileUploadJobView => ({
      id: job.id,
      action: job.action,
      createdAt: job.createdAt,
      status: job.status,
      name: job.name,
      bytes: job.bytes,
      error: job.error,
      hasFile: job.hasFile,
      isChecking: job.isChecking,
      result: job.result,
      canRetry:
        job.status === "failed" &&
        !!job.draft &&
        (job.action === "upload" ? options.canUpload : options.canOverwrite),
    })),
    recordError: recordError ? t("files:uploadRecordsUnavailable") : undefined,
    ready,
    enqueue,
    check: (id: string) => {
      const timer = timers.current.get(id)
      if (timer) clearTimeout(timer)
      timers.current.delete(id)
      void check(id)
    },
    dismiss,
    getRetryDraft: (id: string) =>
      current.current.find((job) => job.id === id)?.draft,
    retryRecords: () => {
      try {
        if (!ready) {
          replace(readUploadRecords(options.storage, key).map(restore))
          setReady(true)
        } else save(current.current)
        setRecordError(false)
      } catch {
        setRecordError(true)
      }
    },
  }
}
