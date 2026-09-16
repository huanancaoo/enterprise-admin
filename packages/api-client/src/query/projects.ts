import {
  ProjectListQuerySchema,
  type SupportedLocale,
} from "@workspace/contracts"
import type {
  GetProjectHeaders,
  ListProjectsHeaders,
  ListProjectsParams,
} from "../generated/models"

export const projectKeys = {
  all: (organizationId: string) =>
    ["organizations", organizationId, "projects"] as const,
  lists: (organizationId: string) =>
    [...projectKeys.all(organizationId), "list"] as const,
  list: (
    organizationId: string,
    params: ListProjectsParams | undefined,
    requestLanguage: string | null
  ) =>
    [
      ...projectKeys.lists(organizationId),
      ProjectListQuerySchema.parse(params ?? {}),
      requestLanguage,
    ] as const,
  details: (organizationId: string, projectId: string) =>
    [...projectKeys.all(organizationId), "detail", projectId] as const,
  detail: (
    organizationId: string,
    projectId: string,
    requestLanguage: string | null
  ) =>
    [
      ...projectKeys.details(organizationId, projectId),
      requestLanguage,
    ] as const,
  translations: (organizationId: string, projectId: string) =>
    [...projectKeys.all(organizationId), "translation", projectId] as const,
  translation: (
    organizationId: string,
    projectId: string,
    locale: SupportedLocale
  ) =>
    [...projectKeys.translations(organizationId, projectId), locale] as const,
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
