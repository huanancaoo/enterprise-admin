import { useCallback, useEffect, useLayoutEffect, useRef } from "react"
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

export function useFileOperationObserver(options: Options) {
  const ports = useRef(options)
  const live = useRef(true)
  const requests = useRef(new Map<string, AbortController>())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const phases = useRef(new Map<string, FileOperationResponse["phase"]>())
  const completed = useRef(new Set<string>())
  useLayoutEffect(() => {
    ports.current = options
  }, [options])
  useEffect(() => {
    live.current = true
    const pending = requests.current
    const scheduled = timers.current
    return () => {
      live.current = false
      for (const request of pending.values()) request.abort()
      for (const timer of scheduled.values()) clearTimeout(timer)
      pending.clear()
      scheduled.clear()
    }
  }, [])

  const cancel = useCallback((id: string) => {
    const timer = timers.current.get(id)
    if (timer) clearTimeout(timer)
    timers.current.delete(id)
    requests.current.get(id)?.abort()
    requests.current.delete(id)
  }, [])
  const readRef = useRef<(id: string) => Promise<void>>(async () => undefined)
  const schedule = useCallback((id: string) => {
    if (!live.current || timers.current.has(id)) return
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id)
        void readRef.current(id)
      }, 1500)
    )
  }, [])
  const publish = useCallback(
    (id: string, operation: FileOperationResponse) => {
      if (!live.current) return
      phases.current.set(id, operation.phase)
      ports.current.onChange(id, { state: "receipt", operation })
      if (operation.phase === "completed" || operation.phase === "failed") {
        const timer = timers.current.get(id)
        if (timer) clearTimeout(timer)
        timers.current.delete(id)
      } else schedule(id)
      if (operation.phase === "completed" && !completed.current.has(id)) {
        completed.current.add(id)
        ports.current.onCompleted(operation)
      }
    },
    [schedule]
  )
  const check = useCallback(
    async (id: string) => {
      if (!live.current || requests.current.has(id)) return
      const timer = timers.current.get(id)
      if (timer) clearTimeout(timer)
      timers.current.delete(id)
      const request = new AbortController()
      requests.current.set(id, request)
      ports.current.onChange(id, { state: "checking" })
      try {
        const operation = await ports.current.readOperation(id, request.signal)
        if (!request.signal.aborted) publish(id, operation)
      } catch (error) {
        // 查询失败结束自动观察，用户仍可显式确认同一个 UUID。
        if (!request.signal.aborted && live.current)
          ports.current.onChange(id, { state: "error", error })
      } finally {
        if (requests.current.get(id) === request) requests.current.delete(id)
      }
    },
    [publish]
  )
  const watch = useCallback(
    async (id: string, start: Start = "later") => {
      const phase = phases.current.get(id)
      if (phase === "completed" || phase === "failed") return
      if (start === "now") await check(id)
      else schedule(id)
    },
    [check, schedule]
  )
  useLayoutEffect(() => {
    readRef.current = (id) => watch(id, "now")
  }, [watch])
  const accept = useCallback(
    (operation: FileOperationResponse, start: Start = "later") => {
      // POST 回执是已确认的新事实，取消此前 GET，防止其迟到结果倒退界面阶段。
      cancel(operation.id)
      publish(operation.id, operation)
      if (start === "now") void watch(operation.id, "now")
    },
    [cancel, publish, watch]
  )
  const forget = useCallback(
    (id: string) => {
      cancel(id)
      phases.current.delete(id)
    },
    [cancel]
  )
  return { accept, watch, check, forget }
}
