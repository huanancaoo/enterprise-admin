import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, within } from "storybook/test"
import type { PlatformMonitor } from "@workspace/contracts/platform-monitor"
import { PlatformMonitorView } from "./page"

const data: PlatformMonitor = {
  observedAt: "2026-10-18T10:00:00.000Z",
  probes: [
    { key: "api", status: "up" },
    { key: "postgres", status: "up", latencyMs: 3 },
    { key: "redis", status: "up", latencyMs: 2 },
    { key: "storage", status: "up", latencyMs: 8 },
  ],
  queues: [
    {
      scope: "organization",
      status: "ready",
      waiting: 2,
      active: 1,
      delayed: 0,
      failed: 3,
    },
    {
      scope: "platform",
      status: "ready",
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
    },
  ],
  platformExecutor: "running",
  worker: { status: "ready", lastSeenAt: "2026-10-18T09:59:58.000Z" },
  http: {
    status: "ready",
    windowSeconds: 300,
    samples: 123,
    requestsPerSecond: 2.1,
    errorRate: 0.01,
    averageDurationMs: 42,
    p95DurationMs: 81,
  },
}
const meta = {
  title: "Platform/Runtime monitor",
  component: PlatformMonitorView,
  args: { data, onRefresh: fn() },
} satisfies Meta<typeof PlatformMonitorView>
export default meta
type Story = StoryObj<typeof meta>
export const Healthy: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole("heading", { name: "运行监控" })
    ).toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: "刷新" }))
    await expect(args.onRefresh).toHaveBeenCalledOnce()
  },
}
export const Unconfigured: Story = {
  args: {
    data: {
      ...data,
      probes: data.probes.map((probe) =>
        probe.key === "storage" ? { key: "storage", status: "disabled" } : probe
      ),
      worker: { status: "unconfigured" },
      http: { status: "unconfigured", windowSeconds: 300 },
    },
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getAllByText("未配置监控数据源；当前状态未知。")
    ).toHaveLength(2)
  },
}
export const StaleAndUnavailable: Story = {
  args: {
    data: {
      ...data,
      probes: data.probes.map((probe) =>
        probe.key === "postgres" ? { ...probe, status: "down" } : probe
      ),
      worker: { status: "stale", lastSeenAt: "2026-10-18T09:50:00.000Z" },
      http: { status: "no-data", windowSeconds: 300 },
      queues: data.queues.map((queue) => ({
        scope: queue.scope,
        status: "unavailable",
      })),
      platformExecutor: "stopped",
    },
  },
}
export const Narrow: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
}
