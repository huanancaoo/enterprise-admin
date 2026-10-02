import { queryOptions } from "@tanstack/react-query"
import type { SupportedLocale } from "@workspace/contracts"
import {
  getProjectAttachments,
  getProjectContent,
} from "../generated/endpoints/projects/projects"
import { requestLanguageHeaders } from "../http/request-locale"
import { projectKeys } from "./projects"

export function getProjectAttachmentsOptions(
  organizationId: string,
  projectId: string,
  authorizationVersion: number,
  requestLanguage: SupportedLocale
) {
  return queryOptions({
    queryKey: projectKeys.attachment(
      organizationId,
      projectId,
      authorizationVersion,
      requestLanguage
    ),
    queryFn: async ({ signal }) =>
      (
        await getProjectAttachments(organizationId, projectId, {
          signal,
          headers: requestLanguageHeaders(requestLanguage),
        })
      ).data,
    retry: false,
  })
}

export function getProjectContentOptions(
  organizationId: string,
  projectId: string,
  authorizationVersion: number,
  locale: SupportedLocale,
  requestLanguage: SupportedLocale
) {
  return queryOptions({
    // 正文语言与界面语言是两项事实，授权变化后必须重新验证读取权限。
    queryKey: projectKeys.content(
      organizationId,
      projectId,
      authorizationVersion,
      locale,
      requestLanguage
    ),
    queryFn: async ({ signal }) =>
      (
        await getProjectContent(organizationId, projectId, locale, {
          signal,
          headers: requestLanguageHeaders(requestLanguage),
        })
      ).data,
    retry: false,
  })
}
