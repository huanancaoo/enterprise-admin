import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  ApiClientError,
  executeFileBatch,
  getFileBatch,
  requestLanguageHeader,
} from "@workspace/api-client"
import {
  ExecuteFileBatchSchema,
  FileBatchResponseSchema,
  type ExecuteFileBatch,
  type FileBatchResponse,
  type SupportedLocale,
} from "@workspace/contracts"
import {
  readFileBatchRecords,
  saveFileBatchRecord,
  type FileBatchRecord,
} from "./file-batch-records"

export type FileBatchPorts = {
  execute: (
    input: ExecuteFileBatch,
    signal: AbortSignal
  ) => Promise<FileBatchResponse>
  read: (batchId: string, signal: AbortSignal) => Promise<FileBatchResponse>
}
export function createFileBatchPorts(
  organizationId: string,
  locale: SupportedLocale
): FileBatchPorts {
  const options = (signal: AbortSignal) => ({
    signal,
    headers: { [requestLanguageHeader]: locale },
  })
  return {
    execute: async (input, signal) =>
      (await executeFileBatch(organizationId, input, options(signal))).data,
    read: async (batchId, signal) =>
      (await getFileBatch(organizationId, batchId, options(signal))).data,
  }
}
type State = {
  scope: string
  records: FileBatchRecord[]
  record?: FileBatchRecord
  response?: FileBatchResponse
  error?: unknown
  submitting: boolean
  original?: ExecuteFileBatch
}
function load(scope: string, recordScope: string): State {
  const records = readFileBatchRecords(recordScope)
  return { scope, records, record: records.at(-1), submitting: false }
}
function phase(response: FileBatchResponse): FileBatchRecord["phase"] {
  const roots = response.items.filter((item) => item.index === item.rootIndex)
  if (roots.some((item) => item.state === "unavailable")) return "unavailable"
  if (
    roots.some(
      (item) =>
        ["preparing", "committed", "cleaning"].includes(item.state) ||
        (item.state === "pending" && item.operation !== null)
    )
  )
    return "processing"
  if (roots.some((item) => item.state === "pending")) return "pending"
  return "settled"
}

export function useFileBatch({
  contentScopeKey,
  recordScopeKey,
  ports,
  canRead = true,
}: {
  contentScopeKey: string
  recordScopeKey: string
  ports: FileBatchPorts
  canRead?: boolean
}) {
  const [stored, setStored] = useState(() =>
    load(contentScopeKey, recordScopeKey)
  )
  // 身份/组织变化时不能把旧批 UUID 交给新组织的端口；仅从当前身份隔离的安全记录恢复查询。
  const current =
    stored.scope === contentScopeKey
      ? stored
      : load(contentScopeKey, recordScopeKey)
  const { records, record, response, error, submitting } = current
  const controller = useRef<AbortController | undefined>(undefined)
  const sending = useRef(false)
  useEffect(
    () => () => {
      controller.current?.abort()
      setStored((previous) => ({ ...previous, original: undefined }))
      sending.current = false
    },
    [contentScopeKey]
  )
  const update = (values: Partial<State>) =>
    setStored((previous) => ({
      ...(previous.scope === contentScopeKey
        ? previous
        : load(contentScopeKey, recordScopeKey)),
      ...values,
    }))
  const remember = (next: FileBatchRecord) => {
    const nextRecords = saveFileBatchRecord(recordScopeKey, next)
    update({ records: nextRecords, record: next })
  }
  const accept = (value: FileBatchResponse, tracked: FileBatchRecord) => {
    const next = FileBatchResponseSchema.parse(value)
    if (
      next.batchId !== tracked.batchId ||
      next.action !== tracked.action ||
      next.items.length !== tracked.itemOperationIds.length ||
      next.items.some(
        (item, index) =>
          item.requestedOperationId !== tracked.itemOperationIds[index]
      )
    )
      throw new Error("Unexpected batch receipt")
    update({ response: next, error: undefined })
    remember({
      ...tracked,
      phase: phase(next),
      updatedAt: new Date().toISOString(),
    })
    return next
  }
  const status = useQuery({
    queryKey: ["file-batch", contentScopeKey, record?.batchId],
    enabled:
      canRead &&
      Boolean(record?.submitted) &&
      !submitting &&
      // 旧授权的不可读结果只停该 scope 的自动查询；新的授权事实允许重新 GET 同一安全身份。
      (record?.phase !== "unavailable" || stored.scope !== contentScopeKey) &&
      (!response ||
        (record?.phase !== "settled" && record?.phase !== "pending")),
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const tracked = record!
      try {
        const value = await ports.read(tracked.batchId, signal)
        if (signal.aborted) return value
        return accept(value, tracked)
      } catch (cause) {
        if (!signal.aborted) {
          update({ error: cause, response: undefined })
          if (
            cause instanceof ApiClientError &&
            (cause.status === 401 || cause.status === 403)
          )
            remember({
              ...tracked,
              phase: "unavailable",
              updatedAt: new Date().toISOString(),
            })
        }
        throw cause
      }
    },
    refetchInterval: (query) =>
      !query.state.error && record?.phase === "processing" ? 1500 : false,
  })
  const send = async (input: ExecuteFileBatch, tracked: FileBatchRecord) => {
    sending.current = true
    update({ submitting: true, error: undefined })
    const request = new AbortController()
    controller.current = request
    try {
      const result = await ports.execute(input, request.signal)
      if (!request.signal.aborted) accept(result, tracked)
    } catch (cause) {
      if (!request.signal.aborted) {
        update({ error: cause })
        remember({
          ...tracked,
          phase:
            cause instanceof ApiClientError &&
            (cause.status === 401 || cause.status === 403)
              ? "unavailable"
              : "unconfirmed",
          updatedAt: new Date().toISOString(),
        })
      }
    } finally {
      if (!request.signal.aborted) {
        sending.current = false
        update({ submitting: false })
      }
    }
  }
  const start = async (input: ExecuteFileBatch) => {
    if (sending.current) return
    const value = ExecuteFileBatchSchema.parse(input)
    const now = new Date().toISOString()
    const tracked: FileBatchRecord = {
      batchId: value.batchId,
      itemOperationIds: value.items.map((item) => item.operationId),
      action: value.action,
      phase: "submitting",
      submitted: true,
      createdAt: now,
      updatedAt: now,
    }
    update({ response: undefined, original: value })
    remember(tracked)
    await send(value, tracked)
  }
  const continueOriginal = async () => {
    if (
      sending.current ||
      !record ||
      current.original?.batchId !== record.batchId
    )
      return
    await send(current.original!, record)
  }
  const selectRecord = (value: FileBatchRecord) => {
    if (sending.current) return
    update({ record: value, response: undefined, error: undefined })
    update({ original: undefined })
  }
  return {
    records,
    record,
    response: canRead ? response : undefined,
    error: error ?? status.error,
    submitting,
    querying: status.isFetching,
    hasOriginal: Boolean(
      current.original && current.original.batchId === record?.batchId
    ),
    start,
    continueOriginal,
    selectRecord,
    check: () => status.refetch(),
  }
}
export type FileBatchState = ReturnType<typeof useFileBatch>
