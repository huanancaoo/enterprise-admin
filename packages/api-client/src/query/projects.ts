import {
  ProjectListQuerySchema,
  SupportedLocaleSchema,
  type SupportedLocale,
} from "@workspace/contracts"
import type {
  ListProjectsHeaders,
  ListProjectsParams,
} from "../generated/models"

export const projectKeys = {
  all: (organizationId: string) =>
    ["organizations", organizationId, "projects"] as const,
  list: (
    organizationId: string,
    params: ListProjectsParams | undefined,
    locale: SupportedLocale
  ) =>
    [
      ...projectKeys.all(organizationId),
      "list",
      ProjectListQuerySchema.parse(params ?? {}),
      locale,
    ] as const,
  detail: (
    organizationId: string,
    projectId: string,
    locale: SupportedLocale
  ) =>
    [...projectKeys.all(organizationId), "detail", projectId, locale] as const,
}

export function listProjectsKey(input: {
  organizationId: string
  params?: ListProjectsParams
  headers?: ListProjectsHeaders
}) {
  // 缓存请求显式携带 UI locale；不能把服务端尚未协商的语言存入一个不确定的 key。
  const locale = SupportedLocaleSchema.parse(input.headers?.["Accept-Language"])
  return projectKeys.list(input.organizationId, input.params, locale)
}

export function projectListOptions<T extends { queryKey: readonly unknown[] }>(
  options: T,
  input: Parameters<typeof listProjectsKey>[0]
): T {
  return { ...options, queryKey: listProjectsKey(input) }
}
