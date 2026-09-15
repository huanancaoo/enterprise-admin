import type { SupportedLocale } from "@workspace/contracts"
import type { ListProjectsParams } from "../generated/models"
import {
  getListProjectsQueryOptions,
  useListProjects,
} from "../generated/endpoints/projects/projects"

// locale 同时成为 key 与 Header 的快照，语言切换后的重试不能写入上一语言的缓存。
export function getProjectsListOptions(
  organizationId: string,
  params: ListProjectsParams | undefined,
  locale: SupportedLocale
) {
  return getListProjectsQueryOptions(organizationId, params, {
    "Accept-Language": locale,
  })
}

export function useProjectsList(
  organizationId: string,
  params: ListProjectsParams | undefined,
  locale: SupportedLocale
) {
  return useListProjects(organizationId, params, { "Accept-Language": locale })
}
