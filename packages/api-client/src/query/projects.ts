import { ProjectListQuerySchema } from "@workspace/contracts"
import type {
  GetProjectHeaders,
  ListProjectsHeaders,
  ListProjectsParams,
} from "../generated/models"

export const projectKeys = {
  all: (organizationId: string) =>
    ["organizations", organizationId, "projects"] as const,
  list: (
    organizationId: string,
    params: ListProjectsParams | undefined,
    requestLanguage: string | null
  ) =>
    [
      ...projectKeys.all(organizationId),
      "list",
      ProjectListQuerySchema.parse(params ?? {}),
      requestLanguage,
    ] as const,
  detail: (
    organizationId: string,
    projectId: string,
    requestLanguage: string | null
  ) =>
    [
      ...projectKeys.all(organizationId),
      "detail",
      projectId,
      requestLanguage,
    ] as const,
}

export function listProjectsKey(input: {
  organizationId: string
  params?: ListProjectsParams
  headers?: ListProjectsHeaders
}) {
  // Key 记录原始请求语言；省略 Header 与显式语言必须属于不同缓存。
  return projectKeys.list(
    input.organizationId,
    input.params,
    input.headers?.["Accept-Language"] ?? null
  )
}

export function getProjectKey(input: {
  organizationId: string
  projectId: string
  headers?: GetProjectHeaders
}) {
  return projectKeys.detail(
    input.organizationId,
    input.projectId,
    input.headers?.["Accept-Language"] ?? null
  )
}

export function projectListOptions<T extends { queryKey: readonly unknown[] }>(
  options: T,
  input: Parameters<typeof listProjectsKey>[0]
): T {
  return { ...options, queryKey: listProjectsKey(input) }
}
