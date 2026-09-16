import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { ApiClientError, getProjectDetailOptions } from "@workspace/api-client"
import { createFormatter, localeMeta } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import {
  ErrorState,
  LoadingState,
  PageHeader,
  PermissionDeniedState,
} from "@workspace/admin"
import { Badge } from "@workspace/ui/components/badge"
import { buttonVariants } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"

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
  const project = query.data?.data
  const errorCode =
    query.error instanceof ApiClientError ? query.error.body.code : undefined

  return (
    <>
      {query.isPending && <LoadingState />}
      {query.isError && errorCode === "FORBIDDEN" && <PermissionDeniedState />}
      {query.isError && errorCode === "NOT_FOUND" && (
        <section role="status" className="space-y-3 py-8">
          <h1 className="text-2xl font-semibold">
            {t("projects:notFoundTitle")}
          </h1>
          <p className="text-muted-foreground">
            {t("projects:notFoundDescription")}
          </p>
          <Link
            to="/app/projects/$organizationId"
            params={{ organizationId }}
            search={{}}
            className={buttonVariants({ variant: "outline" })}
          >
            {t("projects:backToProjects")}
          </Link>
        </section>
      )}
      {query.isError &&
        errorCode !== "FORBIDDEN" &&
        errorCode !== "NOT_FOUND" && (
          <ErrorState onRetry={() => void query.refetch()} />
        )}
      {project && (
        <section className="min-w-0 space-y-6">
          <PageHeader
            title={project.name}
            actions={
              <Link
                to="/app/projects/$organizationId"
                params={{ organizationId }}
                search={{}}
                className={buttonVariants({ variant: "outline" })}
              >
                {t("projects:backToProjects")}
              </Link>
            }
          />
          <Card>
            <CardContent>
              <dl className="grid min-w-0 gap-6 sm:grid-cols-2">
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
        </section>
      )}
    </>
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
import type { ReactNode } from "react"
