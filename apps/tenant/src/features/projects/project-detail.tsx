import { lazy, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { ApiClientError, getProjectDetailOptions } from "@workspace/api-client"
import { createFormatter, localeMeta } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import {
  ErrorState,
  LoadingState,
  AdminPage,
  PermissionDeniedState,
} from "@workspace/admin"
import { Badge } from "@workspace/ui/components/badge"
import { buttonVariants } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import { ProjectAttachmentsSection } from "./project-attachments"
import { ProjectEdit } from "./project-edit"
import { ProjectDelete } from "./project-delete"

const ProjectContent = lazy(() =>
  import("./project-content").then((module) => ({
    default: module.ProjectContent,
  }))
)

const statusBadgeVariant = {
  draft: "secondary",
  active: "default",
  archived: "outline",
} as const

type ProjectDetailProps = {
  organizationId: string
  projectId: string
}

export function ProjectDetail({
  organizationId,
  projectId,
}: ProjectDetailProps) {
  const { t } = useTranslation(["projects", "common", "organization"])
  const locale = useUiLocale()
  const query = useQuery(
    getProjectDetailOptions(organizationId, projectId, locale)
  )
  const errorCode =
    query.error instanceof ApiClientError ? query.error.body.code : undefined
  // 权限撤回或资源删除后，页头与操作也必须撤下缓存中的业务信息。
  const project =
    errorCode === "FORBIDDEN" || errorCode === "NOT_FOUND"
      ? undefined
      : query.data?.data

  return (
    <AdminPage
      title={
        project?.name ??
        (errorCode === "NOT_FOUND"
          ? t("projects:notFoundTitle")
          : t("projects:detail"))
      }
      back={
        <Link
          to="/app/projects/$organizationId"
          params={{ organizationId }}
          search={{}}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          {t("projects:backToProjects")}
        </Link>
      }
      actions={
        project && (
          <>
            <ProjectEdit
              key={`${organizationId}:${project.id}`}
              organizationId={organizationId}
              project={project}
            />
            <ProjectDelete
              organizationId={organizationId}
              projectId={project.id}
              projectName={project.name}
            />
          </>
        )
      }
    >
      {query.isPending && <LoadingState />}
      {query.isError && errorCode === "FORBIDDEN" && <PermissionDeniedState />}
      {query.isError && errorCode === "NOT_FOUND" && (
        <p role="status" className="text-muted-foreground">
          {t("projects:notFoundDescription")}
        </p>
      )}
      {query.isError &&
        errorCode !== "FORBIDDEN" &&
        errorCode !== "NOT_FOUND" && (
          <ErrorState onRetry={() => void query.refetch()} />
        )}
      {project && (
        <section className="min-w-0 space-y-6">
          <Card>
            <CardContent>
              <dl className="grid min-w-0 gap-5 sm:grid-cols-2">
                <DetailField label={t("projects:status")}>
                  <Badge variant={statusBadgeVariant[project.status]}>
                    {t(`projects:${project.status}`)}
                  </Badge>
                </DetailField>
                <DetailField label={t("projects:contentLocale")}>
                  {localeMeta[project.contentLocale].label}
                </DetailField>
                <DetailField label={t("projects:resolvedLocale")}>
                  {localeMeta[project.resolvedLocale].label}
                </DetailField>
                <DetailField label={t("projects:createdAt")}>
                  {createFormatter(locale).dateTime(
                    new Date(project.createdAt),
                    "UTC"
                  )}
                </DetailField>
                <DetailField label={t("projects:updatedAt")}>
                  {createFormatter(locale).dateTime(
                    new Date(project.updatedAt),
                    "UTC"
                  )}
                </DetailField>
                <DetailField
                  label={t("projects:description")}
                  className="sm:col-span-2"
                >
                  {project.description ?? t("projects:noDescription")}
                </DetailField>
              </dl>
            </CardContent>
          </Card>
          <ProjectAttachmentsSection
            key={`${organizationId}:${project.id}`}
            organizationId={organizationId}
            projectId={project.id}
          />
          <ProjectContent
            organizationId={organizationId}
            projectId={project.id}
            initialLocale={project.contentLocale}
          />
        </section>
      )}
    </AdminPage>
  )
}

function DetailField({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-2 wrap-anywhere whitespace-pre-wrap">{children}</dd>
    </div>
  )
}
