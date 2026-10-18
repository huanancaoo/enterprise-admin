import { delay, http, HttpResponse } from "msw"
import {
  CreatePlatformScheduleSchema,
  UpdatePlatformScheduleSchema,
  PlatformScheduleQuerySchema,
  PlatformScheduleRunsQuerySchema,
  type PlatformSchedule,
  type PlatformScheduleRun,
} from "@workspace/contracts/platform-schedules"

export type ScheduleScenario =
  | "success"
  | "empty"
  | "loading"
  | "error"
  | "saveError"
  | "overlap"
  | "authorizationUnavailable"
export const scheduleFixtureId = "c7dd0a27-4f8a-4aef-8d4c-000000009501"
const actorId = "c7dd0a27-4f8a-4aef-8d4c-000000009502"
const timestamp = "2026-10-19T00:00:00.000Z"
export const scheduleFixture: PlatformSchedule = {
  id: scheduleFixtureId,
  name: "Service health",
  type: "platform.health-check",
  cron: "*/5 * * * *",
  timeZone: "Asia/Shanghai",
  status: "enabled",
  createdBy: actorId,
  version: 1,
  nextRunAt: "2026-10-19T00:05:00.000Z",
  lastRunAt: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
}
const runFixture: PlatformScheduleRun = {
  id: "c7dd0a27-4f8a-4aef-8d4c-000000009503",
  scheduleId: scheduleFixtureId,
  scheduleName: scheduleFixture.name,
  taskType: "platform.health-check",
  trigger: "automatic",
  status: "succeeded",
  scheduledAt: timestamp,
  startedAt: timestamp,
  finishedAt: timestamp,
  durationMs: 30,
  requestedBy: null,
  errorCode: null,
  result: {
    observedAt: timestamp,
    probes: [
      { key: "api", status: "up" },
      { key: "postgres", status: "up" },
      { key: "redis", status: "up" },
      { key: "storage", status: "down" },
    ],
    queues: [],
    platformExecutor: "running",
    worker: { status: "ready", lastSeenAt: timestamp },
    http: { status: "ready", windowSeconds: 300 },
  },
}

export function createScheduleScenario(scenario: ScheduleScenario = "success") {
  let rows: PlatformSchedule[] = []
  let runRows: PlatformScheduleRun[] = []
  const writes: { method: string; body: unknown }[] = []
  const queries: URLSearchParams[] = []
  const failure = (
    code = "INTERNAL_ERROR",
    message = "Schedule request failed",
    status = 503
  ) =>
    HttpResponse.json(
      { code, message, locale: "en-US", requestId: "schedule-story" },
      { status }
    )
  const reset = () => {
    rows =
      scenario === "empty"
        ? []
        : Array.from({ length: 25 }, (_, index) => ({
            ...scheduleFixture,
            id:
              index === 0
                ? scheduleFixtureId
                : `c7dd0a27-4f8a-4aef-8d4c-${String(9600 + index).padStart(12, "0")}`,
            name:
              index === 0
                ? scheduleFixture.name
                : `Health ${String(index + 1).padStart(2, "0")}`,
            status: index === 1 ? ("disabled" as const) : ("enabled" as const),
          }))
    runRows = [
      structuredClone(runFixture),
      {
        ...runFixture,
        id: "c7dd0a27-4f8a-4aef-8d4c-000000009504",
        trigger: "manual",
        status: "rejected",
        result: null,
        errorCode:
          scenario === "authorizationUnavailable"
            ? "AUTHORIZATION_UNAVAILABLE"
            : "FORBIDDEN",
      },
    ]
    writes.length = 0
    queries.length = 0
  }
  reset()
  return {
    reset,
    writes,
    queries,
    handlers: [
      http.get("*/api/v1/platform/schedules/types", () =>
        HttpResponse.json([
          {
            type: "platform.health-check",
            requiredPermissions: ["platform.monitor:read"],
          },
        ])
      ),
      http.get("*/api/v1/platform/schedules", async ({ request }) => {
        if (scenario === "loading") await delay("infinite")
        if (scenario === "error") return failure()
        const params = new URL(request.url).searchParams
        queries.push(params)
        const query = PlatformScheduleQuerySchema.parse(
          Object.fromEntries(params)
        )
        const matching = rows.filter(
          (row) =>
            (!query.q ||
              row.name.toLowerCase().includes(query.q.toLowerCase())) &&
            (!query.status || row.status === query.status)
        )
        matching.sort((a, b) => {
          const compared = String(a[query.sortBy]).localeCompare(
            String(b[query.sortBy])
          )
          return query.sortOrder === "asc" ? compared : -compared
        })
        return HttpResponse.json({
          items: matching.slice(
            (query.page - 1) * query.pageSize,
            query.page * query.pageSize
          ),
          total: matching.length,
          page: query.page,
          pageSize: query.pageSize,
        })
      }),
      http.post("*/api/v1/platform/schedules", async ({ request }) => {
        const body = CreatePlatformScheduleSchema.parse(await request.json())
        writes.push({ method: "POST", body })
        if (scenario === "saveError") return failure()
        const row = { ...scheduleFixture, ...body, id: crypto.randomUUID() }
        rows.unshift(row)
        return HttpResponse.json(row, { status: 201 })
      }),
      http.patch(
        "*/api/v1/platform/schedules/:id",
        async ({ request, params }) => {
          const body = UpdatePlatformScheduleSchema.parse(await request.json())
          writes.push({ method: "PATCH", body })
          if (scenario === "saveError") return failure()
          const row = rows.find((row) => row.id === params.id)!
          if (row.version !== body.expectedVersion)
            return failure(
              "CONFLICT",
              "The schedule changed. Refresh and try again.",
              409
            )
          const { expectedVersion, ...values } = body
          Object.assign(row, values, { version: expectedVersion + 1 })
          return HttpResponse.json(row)
        }
      ),
      http.delete("*/api/v1/platform/schedules/:id", ({ params }) => {
        writes.push({ method: "DELETE", body: params.id })
        if (scenario === "overlap")
          return failure(
            "RESOURCE_IN_USE",
            "This schedule is already running.",
            409
          )
        rows = rows.filter((row) => row.id !== params.id)
        return HttpResponse.json({ deleted: true })
      }),
      http.post("*/api/v1/platform/schedules/:id/runs", ({ params }) => {
        writes.push({ method: "RUN", body: params.id })
        if (scenario === "overlap")
          return failure(
            "RESOURCE_IN_USE",
            "This schedule is already running.",
            409
          )
        const row: PlatformScheduleRun = {
          ...runFixture,
          id: crypto.randomUUID(),
          scheduleId: String(params.id),
          trigger: "manual",
          status: "running",
          finishedAt: null,
          durationMs: null,
          result: null,
        }
        runRows.unshift(row)
        return HttpResponse.json(row, { status: 202 })
      }),
      http.get("*/api/v1/platform/schedules/:id/runs", ({ request }) => {
        const params = new URL(request.url).searchParams
        queries.push(params)
        const query = PlatformScheduleRunsQuerySchema.parse(
          Object.fromEntries(params)
        )
        const matching = runRows.filter(
          (row) => !query.status || row.status === query.status
        )
        return HttpResponse.json({
          items: matching.slice(
            (query.page - 1) * query.pageSize,
            query.page * query.pageSize
          ),
          total: matching.length,
          page: query.page,
          pageSize: query.pageSize,
        })
      }),
    ],
  }
}
