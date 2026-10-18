import { z } from "zod"

export const MonitorProbeSchema = z.object({
  key: z.enum(["api", "postgres", "redis", "storage"]),
  status: z.enum(["up", "down", "disabled"]),
  latencyMs: z.number().nonnegative().optional(),
})
export const MonitorQueueSchema = z.object({
  scope: z.enum(["organization", "platform"]),
  status: z.enum(["ready", "unavailable"]),
  waiting: z.number().int().nonnegative().optional(),
  active: z.number().int().nonnegative().optional(),
  delayed: z.number().int().nonnegative().optional(),
  failed: z.number().int().nonnegative().optional(),
})
export const MonitorSignalStatusSchema = z.enum([
  "ready",
  "unconfigured",
  "unavailable",
  "no-data",
  "stale",
])
export const PlatformMonitorSchema = z
  .object({
    observedAt: z.iso.datetime(),
    probes: z.array(MonitorProbeSchema),
    queues: z.array(MonitorQueueSchema),
    platformExecutor: z.enum(["running", "stopped"]),
    worker: z.object({
      status: MonitorSignalStatusSchema,
      lastSeenAt: z.iso.datetime().optional(),
    }),
    http: z.object({
      status: MonitorSignalStatusSchema,
      windowSeconds: z.literal(300),
      samples: z.number().nonnegative().optional(),
      requestsPerSecond: z.number().nonnegative().optional(),
      errorRate: z.number().min(0).max(1).optional(),
      averageDurationMs: z.number().nonnegative().optional(),
      p95DurationMs: z.number().nonnegative().optional(),
    }),
  })
  .meta({ id: "PlatformMonitor" })

export type PlatformMonitor = z.infer<typeof PlatformMonitorSchema>
export type MonitorProbe = z.infer<typeof MonitorProbeSchema>
export type MonitorQueue = z.infer<typeof MonitorQueueSchema>
