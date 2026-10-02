import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
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
  original?: ExecuteFileBatch
  recordError?: unknown
}
function load(scope: string, recordScope: string): State {
  try {
    const records = readFileBatchRecords(recordScope)
    return { scope, records, record: records.at(-1) }
  } catch (recordError) {
    return { scope, records: [], recordError }
  }
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

function parseReceipt(value: FileBatchResponse, tracked: FileBatchRecord) {
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
  return next
}
function denied(error: unknown) {
  return (
    error instanceof ApiClientError &&
    (error.status === 401 || error.status === 403)
  )
}
type Submission = {
  scope: string
  input: ExecuteFileBatch
  tracked: FileBatchRecord
  request: AbortController
  execute: FileBatchPorts["execute"]
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
  const client = useQueryClient()
  const [stored, setStored] = useState(() =>
    load(contentScopeKey, recordScopeKey)
  )
  // 身份/组织变化时不能把旧批 UUID 交给新组织的端口；仅从当前身份隔离的安全记录恢复查询。
  const current =
    stored.scope === contentScopeKey
      ? stored
      : load(contentScopeKey, recordScopeKey)
  const { records, record } = current
  const hasOriginal = Boolean(
    current.original && current.original.batchId === record?.batchId
  )
  const controller = useRef<AbortController | undefined>(undefined)
  const update = useCallback(
    (values: Partial<State> | ((previous: State) => Partial<State>)) =>
      setStored((previous) => {
        const scoped =
          previous.scope === contentScopeKey
            ? previous
            : load(contentScopeKey, recordScopeKey)
        return {
          ...scoped,
          ...(typeof values === "function" ? values(scoped) : values),
        }
      }),
    [contentScopeKey, recordScopeKey]
  )
  const remember = useCallback(
    (next: FileBatchRecord, beforeSubmission = false) => {
      try {
        const nextRecords = saveFileBatchRecord(recordScopeKey, next)
        update({ records: nextRecords, record: next, recordError: undefined })
      } catch (recordError) {
        if (beforeSubmission) {
          update({ recordError })
          throw recordError
        }
        // 正式收据仍是事实；只在第一次 POST 前要求身份落盘，不能因后续记录失败误报已提交操作。
        update((previous) => ({
          recordError,
          records: [
            ...previous.records.filter((item) => item.batchId !== next.batchId),
            next,
          ],
          record: next,
        }))
      }
    },
    [recordScopeKey, update]
  )
  const queryKey = ["file-batch", contentScopeKey, record?.batchId] as const
  const keyFor = (submission: Submission) =>
    ["file-batch", submission.scope, submission.tracked.batchId] as const
  const mutation = useMutation({
    retry: false,
    // 不把离线命令留待联网执行；作用域释放后也不缓存含原始正文的 Mutation。
    networkMode: "always",
    gcTime: 0,
    mutationFn: async (submission: Submission) => {
      submission.request.signal.throwIfAborted()
      const value = await submission.execute(
        submission.input,
        submission.request.signal
      )
      submission.request.signal.throwIfAborted()
      return parseReceipt(value, submission.tracked)
    },
    onMutate: async (submission) => {
      const key = keyFor(submission)
      await client.cancelQueries({ queryKey: key, exact: true })
      // 只记录 Query 的确认次数；后续成功 GET 才取代这次 POST 错误，不能复制一份收据状态。
      return { confirmed: client.getQueryState(key)?.dataUpdateCount ?? 0 }
    },
    onSuccess: (value, submission) => {
      if (submission.request.signal.aborted) return
      const key = keyFor(submission)
      // POST 收据取代此前 GET。取消会回滚旧读取，迟到响应不能覆盖较新的提交事实。
      void client.cancelQueries({ queryKey: key, exact: true })
      client.setQueryData(key, value)
      if (phase(value) === "processing")
        void client.invalidateQueries({
          queryKey: key,
          exact: true,
          refetchType: "none",
        })
    },
    onError: (cause, submission) => {
      if (submission.request.signal.aborted) return
      remember({
        ...submission.tracked,
        phase: denied(cause) ? "unavailable" : "unconfirmed",
        updatedAt: new Date().toISOString(),
      })
      if (!denied(cause))
        void client.invalidateQueries({
          queryKey: keyFor(submission),
          exact: true,
          refetchType: "none",
        })
    },
  })
  const ownSubmission =
    mutation.variables?.scope === contentScopeKey &&
    mutation.variables.tracked.batchId === record?.batchId
  const submitting = ownSubmission && mutation.isPending
  const status = useQuery<FileBatchResponse>({
    queryKey,
    enabled: (query) =>
      canRead &&
      Boolean(record?.submitted) &&
      !submitting &&
      !(
        ownSubmission &&
        mutation.isError &&
        denied(mutation.error) &&
        query.state.dataUpdateCount <= (mutation.context?.confirmed ?? 0)
      ),
    retry: false,
    staleTime: Infinity,
    // 重新挂载只有安全身份，必须重新读取；不能拿先前授权下缓存的终态当本次确认。
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: (query) =>
      record?.phase !== "unavailable" &&
      !denied(query.state.error) &&
      (query.state.error ||
        !query.state.data ||
        record?.phase === "unconfirmed" ||
        phase(query.state.data) === "processing")
        ? "always"
        : false,
    queryFn: async ({ signal }) =>
      parseReceipt(await ports.read(record!.batchId, signal), record!),
    refetchInterval: (query) =>
      !query.state.error &&
      query.state.data &&
      phase(query.state.data) === "processing"
        ? 1500
        : false,
  })
  const confirmations = client.getQueryState(queryKey)?.dataUpdateCount ?? 0
  const postError =
    ownSubmission &&
    mutation.isError &&
    confirmations <= (mutation.context?.confirmed ?? 0)
      ? mutation.error
      : undefined
  // 本次命令的收据可以先于 Query 挂载到达；重挂载只有安全 UUID，必须等待新 GET 确认。
  const receipt =
    status.isError || !(status.isFetchedAfterMount || hasOriginal)
      ? undefined
      : status.data
  const response = canRead ? receipt : undefined
  const syncRecord = useEffectEvent(() => {
    if (!record || submitting) return
    if (denied(status.error))
      remember({
        ...record,
        phase: "unavailable",
        updatedAt: new Date().toISOString(),
      })
    else if (receipt && !postError)
      remember({
        ...record,
        phase: phase(receipt),
        updatedAt: new Date().toISOString(),
      })
  })
  useEffect(() => {
    syncRecord()
  }, [
    status.dataUpdatedAt,
    status.errorUpdatedAt,
    mutation.status,
    contentScopeKey,
    record?.batchId,
  ])
  const resetMutation = mutation.reset
  useEffect(
    () => () => {
      controller.current?.abort()
      controller.current = undefined
      void client.cancelQueries({ queryKey: ["file-batch", contentScopeKey] })
      setStored((previous) => ({ ...previous, original: undefined }))
      resetMutation()
    },
    [client, contentScopeKey, resetMutation]
  )
  useEffect(() => {
    if (!canRead) {
      if (mutation.isError) resetMutation()
      const key = ["file-batch", contentScopeKey, record?.batchId]
      void client.cancelQueries({ queryKey: key, exact: true })
      // 撤销资格时移除整个 Query；恢复后重新绑定实例，首次 GET 的确认基线也随之重建。
      client.removeQueries({ queryKey: key, exact: true })
    }
  }, [
    canRead,
    client,
    contentScopeKey,
    record?.batchId,
    status.dataUpdatedAt,
    status.errorUpdatedAt,
    mutation.isError,
    resetMutation,
  ])
  const send = async (input: ExecuteFileBatch, tracked: FileBatchRecord) => {
    const request = new AbortController()
    controller.current = request
    try {
      await mutation.mutateAsync({
        scope: contentScopeKey,
        input,
        tracked,
        request,
        execute: ports.execute,
      })
    } catch {
      // Mutation 保存请求错误；未知结果只触发原身份 GET，绝不重放原始命令。
    } finally {
      if (controller.current === request) controller.current = undefined
    }
  }
  const start = async (input: ExecuteFileBatch) => {
    if (controller.current) return
    if (current.recordError) throw current.recordError
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
    remember(tracked, true)
    update({ original: value })
    await send(value, tracked)
  }
  const continueOriginal = async () => {
    if (
      controller.current ||
      !record ||
      current.original?.batchId !== record.batchId
    )
      return
    await send(current.original!, record)
  }
  const selectRecord = (value: FileBatchRecord) => {
    if (controller.current) return
    void client.invalidateQueries({
      queryKey: ["file-batch", contentScopeKey, value.batchId],
      exact: true,
      refetchType: "none",
    })
    mutation.reset()
    update({ record: value, original: undefined })
  }
  const retryRecords = () => {
    try {
      const records = record
        ? saveFileBatchRecord(recordScopeKey, record)
        : readFileBatchRecords(recordScopeKey)
      // 修复安全记录不应抹掉本次挂载仍持有的原始正文或正式收据。
      update({ records, recordError: undefined })
    } catch (recordError) {
      update({ recordError })
    }
  }
  return {
    records,
    recordError: current.recordError,
    available: !current.recordError,
    record,
    response,
    error: status.error ?? postError,
    submitting,
    querying: status.isFetching,
    hasOriginal,
    start,
    continueOriginal,
    selectRecord,
    retryRecords,
    check: () => (canRead ? status.refetch() : undefined),
  }
}
export type FileBatchState = ReturnType<typeof useFileBatch>
