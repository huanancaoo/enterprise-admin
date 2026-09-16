import { keepPreviousData, queryOptions } from "@tanstack/react-query"
import type { SupportedLocale } from "@workspace/contracts"
import { ApiClientError } from "../http/client"
import { getProject } from "../generated/endpoints/projects/projects"
import { projectKeys } from "./projects"

export function getProjectDetailOptions(
  organizationId: string,
  projectId: string,
  locale: SupportedLocale
) {
  return queryOptions({
    queryKey: projectKeys.detail(organizationId, projectId, locale),
    queryFn: ({ signal }) =>
      getProject(
        organizationId,
        projectId,
        { "Accept-Language": locale },
        { signal }
      ),
    // 切换界面语言会重取解析后的详情；保留旧详情才能不卸载正在编辑的表单草稿。
    placeholderData: keepPreviousData,
    // 资源不存在是确定结果；重试只会延迟删除后的详情离场。
    retry: (failureCount, error) =>
      !(error instanceof ApiClientError && error.status === 404) &&
      failureCount < 3,
  })
}
