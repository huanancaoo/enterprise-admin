import { StrictMode, useCallback, useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import {
  FileOperationResponseSchema,
  type FileOperationResponse,
} from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import { useFileOperationObserver } from "./use-file-operation-observer"

const operationId = "18d20750-837a-4489-8ddd-6c5e8d39df46"
const date = "2026-10-03T00:00:00.000Z"
const receipt = (phase: "preparing" | "completed" | "failed") =>
  FileOperationResponseSchema.parse({
    id: operationId,
    action: "upload",
    phase,
    committedAt: phase === "completed" ? date : null,
    completedAt: phase === "completed" ? date : null,
    errorCode: phase === "failed" ? "FILE_NAME_CONFLICT" : null,
    result:
      phase === "completed"
        ? { entryId: operationId, versionId: operationId, revision: 1 }
        : null,
    createdAt: date,
    updatedAt: date,
  })

type ScopeProps = {
  read: (id: string, signal: AbortSignal) => Promise<FileOperationResponse>
  completed: (operation: FileOperationResponse) => void
  automatic: boolean
}
function ObservationScope({ read, completed, automatic }: ScopeProps) {
  const [view, setView] = useState("idle")
  const observer = useFileOperationObserver({
    readOperation: read,
    onCompleted: completed,
    onChange: (_id, value) =>
      setView(
        value.state === "receipt"
          ? value.operation.phase
          : value.state === "error"
            ? (value.error as Error).message
            : "checking"
      ),
  })
  const { watch } = observer
  useEffect(() => {
    if (automatic) void watch(operationId, "now")
  }, [automatic, watch])
  // i18next-instrument-ignore
  return (
    <>
      <output aria-label="Observation">{view}</output>
      <Button onClick={() => void observer.watch(operationId, "now")}>
        Watch UUID
      </Button>
      <Button onClick={() => void observer.check(operationId)}>
        Check UUID
      </Button>
      <Button onClick={() => observer.accept(receipt("completed"))}>
        Accept POST receipt
      </Button>
    </>
  )
}
function StrictObservationRoot({
  read,
  completed,
}: Omit<ScopeProps, "automatic">) {
  const container = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    // StrictMode 必须位于测试根，嵌套 StrictMode 不会重跑非 Strict 父树的首次 effects。
    const root = createRoot(container.current!)
    root.render(
      <StrictMode>
        <ObservationScope read={read} completed={completed} automatic />
      </StrictMode>
    )
    return () => root.unmount()
  }, [read, completed])
  return <div ref={container} />
}

type Mode = "lateRead" | "scope" | "error" | "failed" | "strict"
function Fixture({ mode = "lateRead" }: { mode?: Mode }) {
  const [scope, setScope] = useState(1)
  const [reads, setReads] = useState<string[]>([])
  const [completions, setCompletions] = useState(0)
  const [aborted, setAborted] = useState(false)
  const calls = useRef(0)
  const pending = useRef<Array<() => void>>([])
  const read = useCallback(
    async (id: string, signal: AbortSignal) => {
      const call = ++calls.current
      setReads((previous) => [...previous, id])
      signal.addEventListener("abort", () => setAborted(true), { once: true })
      if (mode === "error" && call === 1)
        throw new Error("Status permission removed")
      if (mode === "failed" && call === 1) return receipt("failed")
      if (mode === "lateRead" || mode === "scope")
        // 故意让 adapter 忽略取消，验证 module 仍隔离真实迟到结果与完成通知。
        await new Promise<void>((resolve) => pending.current.push(resolve))
      else await Promise.resolve()
      return receipt(mode === "lateRead" ? "preparing" : "completed")
    },
    [mode]
  )
  const completed = useCallback(() => setCompletions((count) => count + 1), [])
  // i18next-instrument-ignore
  return (
    <main className="space-y-4 p-6">
      <output aria-label="Read identities">{JSON.stringify(reads)}</output>
      <output aria-label="Completion count">{completions}</output>
      <output aria-label="Read aborted">{String(aborted)}</output>
      <Button onClick={() => setScope((value) => value + 1)}>
        Change scope
      </Button>
      <Button onClick={() => pending.current.shift()?.()}>
        Release old GET
      </Button>
      {mode === "strict" ? (
        <StrictObservationRoot key={scope} read={read} completed={completed} />
      ) : (
        <ObservationScope
          key={scope}
          read={read}
          completed={completed}
          automatic={false}
        />
      )}
    </main>
  )
}
const meta = {
  title: "Tenant/File operation observation",
  component: Fixture,
  globals: { locale: "en-US" },
} satisfies Meta<typeof Fixture>
export default meta
type Story = StoryObj<typeof meta>
const reads = (element: HTMLElement): string[] =>
  JSON.parse(within(element).getByLabelText("Read identities").textContent!)

export const PostReceiptCancelsAndSupersedesOldGet: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Watch UUID" }))
    await waitFor(() => expect(reads(canvasElement)).toEqual([operationId]))
    await userEvent.click(
      canvas.getByRole("button", { name: "Accept POST receipt" })
    )
    await expect(canvas.getByLabelText("Read aborted")).toHaveTextContent(
      "true"
    )
    await userEvent.click(
      canvas.getByRole("button", { name: "Release old GET" })
    )
    await expect(canvas.getByLabelText("Observation")).toHaveTextContent(
      "completed"
    )
    await userEvent.click(
      canvas.getByRole("button", { name: "Accept POST receipt" })
    )
    await expect(canvas.getByLabelText("Completion count")).toHaveTextContent(
      "1"
    )
  },
}
export const ScopeCancellationIgnoresLateCompletion: Story = {
  args: { mode: "scope" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Watch UUID" }))
    await waitFor(() => expect(reads(canvasElement)).toEqual([operationId]))
    await userEvent.click(canvas.getByRole("button", { name: "Change scope" }))
    await expect(canvas.getByLabelText("Read aborted")).toHaveTextContent(
      "true"
    )
    await userEvent.click(
      canvas.getByRole("button", { name: "Release old GET" })
    )
    await expect(canvas.getByLabelText("Observation")).toHaveTextContent("idle")
    await expect(canvas.getByLabelText("Completion count")).toHaveTextContent(
      "0"
    )
  },
}
export const ErrorAllowsExplicitCheckOfOriginalIdentity: Story = {
  args: { mode: "error" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Watch UUID" }))
    await waitFor(() =>
      expect(canvas.getByLabelText("Observation")).toHaveTextContent(
        "Status permission removed"
      )
    )
    await expect(reads(canvasElement)).toEqual([operationId])
    await userEvent.click(canvas.getByRole("button", { name: "Check UUID" }))
    await waitFor(() =>
      expect(canvas.getByLabelText("Observation")).toHaveTextContent(
        "completed"
      )
    )
    await expect(reads(canvasElement)).toEqual([operationId, operationId])
    await expect(canvas.getByLabelText("Completion count")).toHaveTextContent(
      "1"
    )
  },
}
export const TerminalStopsWatchButExplicitCheckRemainsExplicit: Story = {
  args: { mode: "failed" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Watch UUID" }))
    await waitFor(() =>
      expect(canvas.getByLabelText("Observation")).toHaveTextContent("failed")
    )
    await userEvent.click(canvas.getByRole("button", { name: "Watch UUID" }))
    await expect(reads(canvasElement)).toEqual([operationId])
    await expect(canvas.getByLabelText("Completion count")).toHaveTextContent(
      "0"
    )
    await userEvent.click(canvas.getByRole("button", { name: "Check UUID" }))
    await waitFor(() =>
      expect(canvas.getByLabelText("Completion count")).toHaveTextContent("1")
    )
    await expect(reads(canvasElement)).toEqual([operationId, operationId])
  },
}
export const StrictModeReopensObservationAndCompletesOnce: Story = {
  args: { mode: "strict" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() =>
      expect(canvas.getByLabelText("Completion count")).toHaveTextContent("1")
    )
    await expect(reads(canvasElement).every((id) => id === operationId)).toBe(
      true
    )
    await expect(canvas.getByLabelText("Read aborted")).toHaveTextContent(
      "true"
    )
    await userEvent.click(canvas.getByRole("button", { name: "Watch UUID" }))
    await expect(canvas.getByLabelText("Completion count")).toHaveTextContent(
      "1"
    )
  },
}
