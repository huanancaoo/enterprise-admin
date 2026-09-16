import { keepPreviousData, queryOptions } from "@tanstack/react-query"
import type { SupportedLocale } from "@workspace/contracts"
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
  })
}
