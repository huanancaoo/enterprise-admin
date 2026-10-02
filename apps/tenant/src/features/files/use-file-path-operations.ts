import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { ApiClientError } from "@workspace/api-client"
import {
  FileOperationIdSchema,
  FileOperationPhaseSchema,
  FileOperationResponseSchema,
  RenameFileEntrySchema,
  MoveFileEntrySchema,
  TrashFileEntrySchema,
  RestoreFileEntrySchema,
  PurgeFileEntrySchema,
  type FileEntryResponse,
  type FileOperationResponse,
  type RenameFileEntry,
  type MoveFileEntry,
  type TrashFileEntry,
  type RestoreFileEntry,
  type PurgeFileEntry,
} from "@workspace/contracts"
import { fileRequestErrorMessage } from "./file-queries"
import { useFileOperationObserver } from "./use-file-operation-observer"

const pathActionSchema = z.enum(["rename", "move", "trash", "restore", "purge"])
export type FilePathAction = z.infer<typeof pathActionSchema>
const recordSchema = z.strictObject({
  id: FileOperationIdSchema,
  action: pathActionSchema,
  phase: z.enum(["unconfirmed", ...FileOperationPhaseSchema.options]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
const recordsSchema = z.array(recordSchema)
type Record = z.infer<typeof recordSchema>
export type FilePathCommand = { entry: FileEntryResponse } & (
  | { action: "rename"; name: string }
  | { action: "move"; parentId: string }
  | { action: "trash" | "purge" }
  | { action: "restore"; parentId?: string; name?: string }
)
export type FilePathBody =
  | RenameFileEntry
  | MoveFileEntry
  | TrashFileEntry
  | RestoreFileEntry
  | PurgeFileEntry
export type FilePathJob = Record & {
  entryId?: string
  name?: string
  error?: string
  isChecking: boolean
  operation?: FileOperationResponse
}
type Options = {
  userId: string
  organizationId: string
  storage: Pick<Storage, "getItem" | "setItem">
  canPerform: (command: FilePathCommand) => boolean
  submit: (
    action: FilePathAction,
    entryId: string,
    body: FilePathBody,
    signal: AbortSignal
  ) => Promise<FileOperationResponse>
  readOperation: (
    id: string,
    signal: AbortSignal
  ) => Promise<FileOperationResponse>
  onCompleted: (operation: FileOperationResponse) => void
}

export function filePathRecordKey(userId: string, organizationId: string) {
  return `enterprise-admin:file-path-operations:${JSON.stringify([userId, organizationId])}`
}
function terminal(phase: FilePathJob["phase"]) {
  return phase === "completed" || phase === "failed"
}
function body(command: FilePathCommand, operationId: string): FilePathBody {
  const base = { operationId, expectedRevision: command.entry.revision }
  switch (command.action) {
    case "rename":
      return RenameFileEntrySchema.parse({ ...base, name: command.name })
    case "move":
      return MoveFileEntrySchema.parse({ ...base, parentId: command.parentId })
    case "trash":
      return TrashFileEntrySchema.parse(base)
    case "purge":
      return PurgeFileEntrySchema.parse(base)
    case "restore":
      return RestoreFileEntrySchema.parse({
        ...base,
        ...(command.parentId ? { parentId: command.parentId } : {}),
        ...(command.name !== undefined ? { name: command.name } : {}),
      })
  }
}

export function useFilePathOperations(options: Options) {
  const { t } = useTranslation(["files", "errors", "common"])
  const key = filePathRecordKey(options.userId, options.organizationId)
  const [initial] = useState(() => {
    try {
      const saved = options.storage.getItem(key)
      return {
        jobs: saved === null ? [] : recordsSchema.parse(JSON.parse(saved)),
        available: true,
      }
    } catch {
      return { jobs: [] as Record[], available: false }
    }
  })
  const [jobs, setJobs] = useState<FilePathJob[]>(() =>
    initial.jobs.map((record) => ({ ...record, isChecking: false }))
  )
  const current = useRef(jobs)
  const ports = useRef(options)
  const live = useRef(true)
  const requests = useRef(new Map<string, AbortController>())
  const [recordError, setRecordError] = useState(!initial.available)
  useEffect(() => {
    ports.current = options
  }, [options])
  useEffect(() => {
    live.current = true
    const pending = requests.current
    return () => {
      live.current = false
      for (const controller of pending.values()) controller.abort()
      pending.clear()
    }
  }, [])

  const replace = useCallback((next: FilePathJob[]) => {
    current.current = next
    if (live.current) setJobs(next)
  }, [])
  const persist = useCallback(
    (next: FilePathJob[]) => {
      // 只保存操作身份和阶段。名称、层级、条目与表单内容在授权范围离开后释放。
      options.storage.setItem(
        key,
        JSON.stringify(
          recordsSchema.parse(
            next.map(({ id, action, phase, createdAt, updatedAt }) => ({
              id,
              action,
              phase,
              createdAt,
              updatedAt,
            }))
          )
        )
      )
      setRecordError(false)
    },
    [key, options.storage]
  )
  const update = useCallback(
    (id: string, patch: Partial<FilePathJob>) => {
      const next = current.current.map((job) =>
        job.id === id ? { ...job, ...patch } : job
      )
      try {
        persist(next)
      } catch {
        // 已返回的正式收据仍是事实；本地记录失败不能把已提交操作改报为失败。
        setRecordError(true)
      }
      replace(next)
    },
    [persist, replace]
  )
  const observer = useFileOperationObserver({
    readOperation: async (id, signal) =>
      FileOperationResponseSchema.parse(
        await options.readOperation(id, signal)
      ),
    onCompleted: options.onCompleted,
    onChange: (id, observation) => {
      if (observation.state === "checking") {
        update(id, { isChecking: true })
        return
      }
      if (observation.state === "error") {
        update(id, {
          isChecking: false,
          error: fileRequestErrorMessage(
            observation.error,
            t("files:pathStatusUnavailable")
          ),
        })
        return
      }
      const operation = observation.operation
      update(id, {
        phase: operation.phase,
        updatedAt: operation.updatedAt,
        operation,
        isChecking: false,
        error: operation.errorCode
          ? t(`errors:${operation.errorCode}`)
          : undefined,
      })
    },
  })
  const { accept, watch, check, forget } = observer
  useEffect(() => {
    for (const job of initial.jobs)
      if (!terminal(job.phase)) void watch(job.id, "now")
  }, [initial.jobs, watch])

  const execute = async (command: FilePathCommand) => {
    if (!initial.available || recordError)
      throw new Error(t("files:pathRecordUnavailable"))
    if (!ports.current.canPerform(command))
      throw new Error(t("common:permissionDescription"))
    const id = crypto.randomUUID()
    const input = body(command, id)
    const at = new Date().toISOString()
    const record: FilePathJob = {
      id,
      action: command.action,
      phase: "unconfirmed",
      createdAt: at,
      updatedAt: at,
      name: command.entry.name,
      entryId: command.entry.id,
      isChecking: true,
    }
    const next = [...current.current, record]
    // 必须先持久保存 UUID，再发起写请求；刷新只读该身份，不重放旧表单。
    try {
      persist(next)
    } catch {
      setRecordError(true)
      throw new Error(t("files:pathRecordUnavailable"))
    }
    replace(next)
    const controller = new AbortController()
    requests.current.set(id, controller)
    let response: FileOperationResponse
    try {
      response = await ports.current.submit(
        command.action,
        command.entry.id,
        input,
        controller.signal
      )
    } catch (error) {
      if (controller.signal.aborted) return
      const known = error instanceof ApiClientError && error.status < 500
      update(id, {
        phase: known ? "failed" : "unconfirmed",
        isChecking: false,
        error: fileRequestErrorMessage(error, t("files:pathUnconfirmed")),
      })
      if (known) throw error
      void watch(id)
      return
    } finally {
      if (requests.current.get(id) === controller) requests.current.delete(id)
    }
    if (controller.signal.aborted) return
    const operation = FileOperationResponseSchema.parse(response)
    accept(operation)
    if (operation.phase === "failed")
      throw new Error(t(`errors:${operation.errorCode!}`))
  }
  const dismiss = (id: string) => {
    const job = current.current.find((item) => item.id === id)
    if (!job || !terminal(job.phase)) return
    const next = current.current.filter((item) => item.id !== id)
    try {
      persist(next)
      forget(id)
      replace(next)
    } catch {
      setRecordError(true)
    }
  }
  return {
    jobs,
    execute,
    check: async (id: string) => {
      const job = current.current.find((value) => value.id === id)
      if (job && !terminal(job.phase) && !requests.current.has(id))
        await check(id)
    },
    dismiss,
    recordError,
    available: initial.available && !recordError,
  }
}
