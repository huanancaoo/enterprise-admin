import { queryOptions } from "@tanstack/react-query"
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
  })
}
