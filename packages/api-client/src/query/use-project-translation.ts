import { queryOptions } from "@tanstack/react-query"
import type { SupportedLocale } from "@workspace/contracts"
import { getProjectTranslation } from "../generated/endpoints/projects/projects"
import { projectKeys } from "./projects"

export function getProjectTranslationOptions(
  organizationId: string,
  projectId: string,
  locale: SupportedLocale
) {
  return queryOptions({
    // 原始译文不是按界面语言解析的详情表示，目标内容语言必须成为独立缓存维度。
    queryKey: projectKeys.translation(organizationId, projectId, locale),
    queryFn: ({ signal }) =>
      getProjectTranslation(organizationId, projectId, locale, { signal }),
    // 404 是“该目标语言可新建”的正常编辑状态，不能让默认重试长期遮住空表单。
    retry: false,
  })
}
