import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { ConfirmDangerAction } from "@workspace/admin"
import { deleteProject, projectKeys } from "@workspace/api-client"
import { useUiLocale } from "@workspace/i18n/react"

type ProjectDeleteProps = {
  organizationId: string
  projectId: string
  projectName: string
}

export function ProjectDelete({
  organizationId,
  projectId,
  projectName,
}: ProjectDeleteProps) {
  const { t } = useTranslation(["projects", "common"])
  const locale = useUiLocale()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  const onConfirm = () => {
    void (async () => {
      setFailed(false)
      setPending(true)
      try {
        await deleteProject(organizationId, projectId, {
          headers: { "Accept-Language": locale },
        })
        // 详情按请求语言缓存；删除后不能让任一语言继续展示已不存在的资源。
        queryClient.removeQueries({
          queryKey: projectKeys.details(organizationId, projectId),
        })
        queryClient.removeQueries({
          queryKey: projectKeys.translations(organizationId, projectId),
        })
        await queryClient.invalidateQueries({
          queryKey: projectKeys.lists(organizationId),
          refetchType: "all",
        })
        await navigate({
          to: "/app/projects/$organizationId",
          params: { organizationId },
          search: {},
        })
      } catch {
        setFailed(true)
      } finally {
        setPending(false)
      }
    })()
  }

  return (
    <ConfirmDangerAction
      triggerLabel={t("projects:delete")}
      title={t("projects:deleteTitle")}
      description={t("projects:deleteDescription", { name: projectName })}
      cancelLabel={t("common:cancel")}
      confirmLabel={t("projects:deleteConfirm")}
      pendingLabel={t("projects:deleting")}
      pending={pending}
      error={failed ? t("common:operationFailed") : undefined}
      onConfirm={onConfirm}
    />
  )
}
