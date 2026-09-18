import { keepPreviousData, useQuery } from "@tanstack/react-query"
import type { SupportedLocale } from "@workspace/contracts"
import type { ListProjectsParams } from "../generated/models"
import { getListProjectsQueryOptions } from "../generated/endpoints/projects/projects"

// locale 同时成为 key 与 Header 的快照，语言切换后的重试不能写入上一语言的缓存。
export function getProjectsListOptions(
  organizationId: string,
  params: ListProjectsParams | undefined,
  locale: SupportedLocale
) {
  return {
    ...getListProjectsQueryOptions(organizationId, params, {
      "Accept-Language": locale,
    }),
    placeholderData: keepPreviousData,
  }
}

export function useProjectsList(
  organizationId: string,
  params: ListProjectsParams | undefined,
  locale: SupportedLocale
) {
  return useQuery(getProjectsListOptions(organizationId, params, locale))
}
