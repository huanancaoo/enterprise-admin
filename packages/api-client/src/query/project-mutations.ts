import type { QueryClient } from "@tanstack/react-query"
import type {
  CreateProject,
  UpdateProject,
  SupportedLocale,
} from "@workspace/contracts"
import {
  createProject,
  updateProject,
  deleteProject,
} from "../generated/endpoints/projects/projects"
import { projectKeys } from "./projects"

// 返回即表示写入已提交；refreshed 只描述读回进度，调用者不能把它当作写入结果重试。
export function createProjectMutations(
  queryClient: QueryClient,
  organizationId: string,
  locale: SupportedLocale
) {
  return {
    async create(input: CreateProject) {
      const response = await createProject(organizationId, input, {
        "Accept-Language": locale,
      })
      return {
        response,
        refreshed: queryClient.invalidateQueries({
          queryKey: projectKeys.all(organizationId),
        }),
      }
    },
    async update(projectId: string, input: UpdateProject) {
      const response = await updateProject(organizationId, projectId, input, {
        "Accept-Language": locale,
      })
      // 写响应是当前请求语言的服务端事实，不能把目标内容语言的表单值写入此缓存。
      queryClient.setQueryData(
        projectKeys.detail(organizationId, projectId, locale),
        response
      )
      return {
        response,
        refreshed: queryClient.invalidateQueries({
          queryKey: projectKeys.all(organizationId),
        }),
      }
    },
    async delete(projectId: string) {
      const response = await deleteProject(organizationId, projectId, {
        headers: { "Accept-Language": locale },
      })
      // 先取消旧读请求，再删除全部语言的详情与原始译文，避免在途响应重建已删除资源。
      await queryClient.cancelQueries({
        queryKey: projectKeys.details(organizationId, projectId),
      })
      await queryClient.cancelQueries({
        queryKey: projectKeys.translations(organizationId, projectId),
      })
      queryClient.removeQueries({
        queryKey: projectKeys.details(organizationId, projectId),
      })
      queryClient.removeQueries({
        queryKey: projectKeys.translations(organizationId, projectId),
      })
      return {
        response,
        refreshed: queryClient.invalidateQueries({
          queryKey: projectKeys.lists(organizationId),
          refetchType: "all",
        }),
      }
    },
  }
}
