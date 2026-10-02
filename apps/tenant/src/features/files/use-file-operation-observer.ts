import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { QueryObserver, useQueryClient } from "@tanstack/react-query"
import type { FileOperationResponse } from "@workspace/contracts"

type Observation =
  | { state: "checking" }
  | { state: "receipt"; operation: FileOperationResponse }
  | { state: "error"; error: unknown }

type Options = {
  readOperation: (
    id: string,
    signal: AbortSignal
  ) => Promise<FileOperationResponse>
  onChange: (id: string, observation: Observation) => void
  onCompleted: (operation: FileOperationResponse) => void
}
type Start = "now" | "later"
type Subscription = {
  observer: QueryObserver<FileOperationResponse | null, unknown>
  unsubscribe: () => void
}

export function useFileOperationObserver(options: Options) {
  const client = useQueryClient()
  // 每个实例属于现有授权范围的 keyed 树；同 UUID 不向其它调用者或新授权范围共享收据。
  const [scope] = useState(
    () => ["file-operation-observation", crypto.randomUUID()] as const
  )
  const ports = useRef(options)
  const live = useRef(true)
  const subscriptions = useRef(new Map<string, Subscription>())
  const completed = useRef(new Set<string>())
  useLayoutEffect(() => {
    ports.current = options
  }, [options])
  useEffect(() => {
    live.current = true
    const active = subscriptions.current
    return () => {
      live.current = false
      for (const entry of active.values()) entry.unsubscribe()
      active.clear()
      void client.cancelQueries({ queryKey: scope })
      client.removeQueries({ queryKey: scope })
    }
  }, [client, scope])

  const observe = useCallback(
    (id: string) => {
      const existing = subscriptions.current.get(id)
      if (existing) return existing.observer
      const observer = new QueryObserver<FileOperationResponse | null, unknown>(
        client,
        {
          queryKey: [...scope, id],
          queryFn: ({ signal }) => ports.current.readOperation(id, signal),
          // null 仅表示尚无收据。挂载不读取，让 Query 的轮询承担 later 的第一次等待。
          initialData: null,
          staleTime: Infinity,
          gcTime: 0,
          retry: false,
          networkMode: "always",
          refetchOnMount: false,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
          refetchIntervalInBackground: true,
          refetchInterval: (query) => {
            const phase = query.state.data?.phase
            return query.state.error ||
              phase === "completed" ||
              phase === "failed"
              ? false
              : 1500
          },
        }
      )
      const unsubscribe = observer.subscribe((result) => {
        if (!live.current) return
        if (result.isFetching) {
          ports.current.onChange(id, { state: "checking" })
        } else if (result.isError) {
          ports.current.onChange(id, { state: "error", error: result.error })
        } else if (result.data) {
          ports.current.onChange(id, {
            state: "receipt",
            operation: result.data,
          })
          if (result.data.phase === "completed" && !completed.current.has(id)) {
            completed.current.add(id)
            ports.current.onCompleted(result.data)
          }
        }
      })
      subscriptions.current.set(id, { observer, unsubscribe })
      return observer
    },
    [client, scope]
  )
  const check = useCallback(
    async (id: string) => {
      if (!live.current) return
      await observe(id).refetch({ cancelRefetch: false })
    },
    [observe]
  )
  const watch = useCallback(
    async (id: string, start: Start = "later") => {
      if (!live.current) return
      const observer = observe(id)
      const phase = observer.getCurrentResult().data?.phase
      if (phase === "completed" || phase === "failed") return
      if (start === "now") await observer.refetch({ cancelRefetch: false })
    },
    [observe]
  )
  const accept = useCallback(
    (operation: FileOperationResponse, start: Start = "later") => {
      if (!live.current) return
      observe(operation.id)
      // Query 同步取消旧 GET 后再保存 POST 回执，迟到的读取不能倒退已确认事实。
      void client.cancelQueries({
        queryKey: [...scope, operation.id],
        exact: true,
      })
      client.setQueryData([...scope, operation.id], operation)
      if (start === "now") void watch(operation.id, "now")
    },
    [client, scope, observe, watch]
  )
  const forget = useCallback(
    (id: string) => {
      subscriptions.current.get(id)?.unsubscribe()
      subscriptions.current.delete(id)
      client.removeQueries({ queryKey: [...scope, id], exact: true })
    },
    [client, scope]
  )
  return { accept, watch, check, forget }
}
