import { savePlatformDownload, platformTaskKeys } from "./task-utils"
import { useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate, useRouteContext } from "@tanstack/react-router"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import { nextIdempotencyAttempt } from "@workspace/admin"
import {
  createPlatformExportTask,
  createPlatformEmployeeImportTask,
  getPlatformEmployeeImportTemplate,
} from "@workspace/api-client"
import {
  CreatePlatformExportTaskSchema,
  CreatePlatformEmployeeImportTaskSchema,
  PlatformTaskSchema,
} from "@workspace/contracts/platform-tasks"
import { usePlatformAccessFailure } from "../../lib/use-platform-access-failure"
import {
  PlatformExportAction,
  PlatformEmployeeImportAction,
  type PlatformExportResource,
  type EmployeeImportValue,
} from "./task-action-forms"

const resources = {
  employee: "employees",
  role: "roles",
  post: "posts",
  dictionary: "dictionaries",
  dictionaryItem: "dictionary-items",
  parameter: "parameters",
  audit: "audit-events",
  login: "login-events",
  menu: "menus",
  department: "departments",
  user: "users",
  organization: "organizations",
  session: "sessions",
} as const
async function fingerprint(value: unknown) {
  const buffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value))
  )
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}
function useTaskSubmission() {
  const user = useAuthenticatedSession()!.user
  const client = useQueryClient()
  const navigate = useNavigate()
  const { platformAccess } = useRouteContext({ from: "/platform" })
  const rejectAccess = usePlatformAccessFailure()
  const lastRequest = useRef<{ fingerprint: string; key: string } | null>(null)
  const submit = async <T,>(
    body: T,
    request: (
      body: T,
      options: { headers: { "Idempotency-Key": string } }
    ) => Promise<{ data: unknown }>
  ) => {
    const signature = await fingerprint(body)
    // 网络结果未知时重试同一提交；变更输入属于新任务，不能复用旧幂等键。
    lastRequest.current = nextIdempotencyAttempt(
      lastRequest.current,
      lastRequest.current?.fingerprint === signature,
      (key) => ({ fingerprint: signature, key }),
    )
    try {
      const result = PlatformTaskSchema.parse(
        (
          await request(body, {
            headers: { "Idempotency-Key": lastRequest.current.key },
          })
        ).data
      )
      lastRequest.current = null
      await client.invalidateQueries({
        queryKey: platformTaskKeys.scope(user.id),
      })
      return result
    } catch (error) {
      void rejectAccess(error)
      throw error
    }
  }
  return {
    submit,
    openTask: platformAccess.permissions.includes("platform.task:read")
      ? (taskId: string) => {
          void navigate({
            to: "/platform/tasks",
            search: { page: 1, pageSize: 20, taskId },
          })
        }
      : undefined,
  }
}
export function PlatformExportButton({
  resource,
  filters,
  dictionaryId,
}: {
  resource: PlatformExportResource
  filters: Record<string, unknown>
  dictionaryId?: string
}) {
  const { submit, openTask } = useTaskSubmission()
  return (
    <PlatformExportAction
      onOpenTask={openTask}
      onSubmit={() => {
        const appliedFilters = Object.fromEntries(
          Object.entries(filters).filter(
            ([key]) => key !== "page" && key !== "pageSize"
          )
        )
        const value = CreatePlatformExportTaskSchema.parse({
          resource: resources[resource],
          filters: {
            ...appliedFilters,
            ...(dictionaryId ? { dictionaryId } : {}),
          },
        })
        return submit(value, (body, options) =>
          createPlatformExportTask(body, options.headers)
        )
      }}
    />
  )
}
async function fileBase64(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const result = String(reader.result)
      resolve(result.slice(result.indexOf(",") + 1))
    }
    reader.readAsDataURL(file)
  })
}
export function PlatformEmployeeImportButton() {
  const { submit, openTask } = useTaskSubmission()
  return (
    <PlatformEmployeeImportAction
      onOpenTask={openTask}
      onDownloadTemplate={async () => {
        const reply = await getPlatformEmployeeImportTemplate()
        savePlatformDownload(reply.data, "employees-import-template.xlsx")
      }}
      onSubmit={async (value: EmployeeImportValue) => {
        const body = CreatePlatformEmployeeImportTaskSchema.parse({
          fileName: value.file.name,
          contentBase64: await fileBase64(value.file),
          initialPassword: value.initialPassword,
          updateExisting: value.updateExisting,
        })
        return submit(body, (input, options) =>
          createPlatformEmployeeImportTask(input, options.headers)
        )
      }}
    />
  )
}
