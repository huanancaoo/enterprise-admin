import { http, HttpResponse } from "msw"
import {
  BusinessTaskSchema,
  TaskCenterPageSchema,
  OrganizationAccessSchema,
  FileBatchResponseSchema,
  ApiErrorSchema,
} from "@workspace/contracts"
export const taskCenterOrganizationId = "a412b4c5-8111-4111-a111-111111111111"
export const taskCenterUser = {
  id: "a412b4c5-8111-4111-a111-222222222222",
  name: "Task actor",
  email: "task@example.test",
}
export const taskCenterTask = BusinessTaskSchema.parse({
  id: "a412b4c5-8111-4111-a111-333333333333",
  organizationId: taskCenterOrganizationId,
  actorId: taskCenterUser.id,
  type: "projects.import",
  status: "failed",
  format: "csv",
  createdAt: "2026-10-11T01:00:00.000Z",
  updatedAt: "2026-10-11T01:00:01.000Z",
  errorCode: "IMPORT_VALIDATION_FAILED",
  result: {
    count: 0,
    issues: [{ row: 3, field: "name", code: "INVALID_NAME" }],
  },
  resultAvailable: false,
})
export function createTaskCenterScenario(
  mode: "own" | "organization" | "file-batch" | "active-denied" = "own"
) {
  let denied = false
  let reads = 0
  let version = 1
  let visibility: "own" | "organization" =
    mode === "organization" ? "organization" : "own"
  const foreignActor = "a412b4c5-8111-4111-a111-555555555555"
  const batchId = "a412b4c5-8111-4111-a111-444444444444"
  const batch = FileBatchResponseSchema.parse({
    batchId,
    action: "trash",
    createdAt: taskCenterTask.createdAt,
    items: [
      {
        index: 0,
        entryId: "a412b4c5-8111-4111-a111-666666666666",
        requestedOperationId: taskCenterTask.id,
        operationId: taskCenterTask.id,
        rootIndex: 0,
        state: "cleaning",
        operation: null,
        error: null,
      },
      {
        index: 1,
        entryId: "a412b4c5-8111-4111-a111-777777777777",
        requestedOperationId: "a412b4c5-8111-4111-a111-888888888888",
        operationId: taskCenterTask.id,
        rootIndex: 0,
        state: "covered",
        operation: null,
        error: null,
      },
    ],
  })
  return {
    reset: () => {
      denied = false
      reads = 0
      version = 1
      visibility = mode === "organization" ? "organization" : "own"
    },
    downgrade: () => {
      version += 1
      visibility = "own"
    },
    deny: () => {
      denied = true
    },
    readCount: () => reads,
    handlers: [
      http.get("*/api/v1/organizations/:organizationId/access", () =>
        HttpResponse.json(
          OrganizationAccessSchema.parse({
            organizationId: taskCenterOrganizationId,
            status: "ACTIVE",
            authorizationVersion: version,
            effectiveLocale: "en-US",
            effectiveLocaleSource: "user",
          })
        )
      ),
      http.get("*/api/v1/organizations/:organizationId/task-center", () => {
        reads += 1
        if (denied)
          return HttpResponse.json(
            ApiErrorSchema.parse({
              code: "FORBIDDEN",
              message: "Task access denied",
              locale: "en-US",
              requestId: "task-denied",
            }),
            { status: 403 }
          )
        return HttpResponse.json(
          TaskCenterPageSchema.parse({
            items:
              mode === "file-batch"
                ? [
                    {
                      id: batchId,
                      actorId: taskCenterUser.id,
                      type: "trash",
                      status: null,
                      source: "file-batch",
                      states: [
                        { state: "cleaning", count: 1 },
                        { state: "covered", count: 1 },
                      ],
                      createdAt: taskCenterTask.createdAt,
                      updatedAt: taskCenterTask.updatedAt,
                      errorCode: null,
                      resultAvailable: true,
                    },
                  ]
                : [
                    {
                      id: taskCenterTask.id,
                      actorId:
                        visibility === "organization"
                          ? foreignActor
                          : taskCenterTask.actorId,
                      type: taskCenterTask.type,
                      status:
                        mode === "active-denied"
                          ? "queued"
                          : taskCenterTask.status,
                      source: "business",
                      states: null,
                      createdAt: taskCenterTask.createdAt,
                      updatedAt: taskCenterTask.updatedAt,
                      errorCode: taskCenterTask.errorCode,
                      resultAvailable: false,
                    },
                  ],
            visibility,
            total: 1,
            page: 1,
            pageSize: 20,
          })
        )
      }),
      http.get(
        "*/api/v1/organizations/:organizationId/files/batches/:batchId",
        () => HttpResponse.json(batch)
      ),
      http.get("*/api/v1/organizations/:organizationId/tasks/:taskId", () =>
        HttpResponse.json(taskCenterTask)
      ),
    ],
  }
}
