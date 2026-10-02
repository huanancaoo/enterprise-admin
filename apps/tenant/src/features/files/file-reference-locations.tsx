import { Link } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  ErrorState,
  LoadingState,
  PermissionDeniedState,
} from "@workspace/admin"
import type { FileReferenceLocations } from "@workspace/contracts"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { Button } from "@workspace/ui/components/button"
import {
  fileRequestErrorMessage,
  fileRequestIsDenied,
  getFileReferenceLocationsOptions,
} from "./file-queries"

export function FileReferenceLocations({
  organizationId,
  entryId,
  authorizationVersion,
}: {
  organizationId: string
  entryId: string
  authorizationVersion: number
}) {
  const { t } = useTranslation(["files", "common"])
  const locale = useUiLocale()
  const references = useQuery(
    getFileReferenceLocationsOptions(
      organizationId,
      authorizationVersion,
      entryId,
      locale
    )
  )
  return (
    <section aria-label={t("files:referencesTitle")} className="space-y-3">
      <h2 className="font-semibold">{t("files:referencesTitle")}</h2>
      {fileRequestIsDenied(references.error) ? (
        <PermissionDeniedState />
      ) : references.isError ? (
        <ErrorState
          message={fileRequestErrorMessage(
            references.error,
            t("common:operationFailed")
          )}
          onRetry={() => void references.refetch()}
        />
      ) : references.data ? (
        <FileReferenceLocationList
          organizationId={organizationId}
          references={references.data}
        />
      ) : (
        <LoadingState />
      )}
    </section>
  )
}

export function FileReferenceLocationList({
  organizationId,
  references,
}: {
  organizationId: string
  references: FileReferenceLocations
}) {
  const { t } = useTranslation("files")
  const locale = useUiLocale()
  const hidden = references.total - references.items.length
  return (
    <div className="space-y-3">
      <p>
        {references.total === 0
          ? t("referencesEmpty")
          : t("referencesCount", {
              quantity: createFormatter(locale).number(references.total),
            })}
      </p>
      {hidden > 0 && (
        <p className="text-sm text-muted-foreground">
          {t("referencesHidden", {
            quantity: createFormatter(locale).number(hidden),
          })}
        </p>
      )}
      <ul className="space-y-3">
        {references.items.map((item, index) => (
          <li
            key={index}
            className="min-w-0 space-y-1 rounded-lg border p-3 [overflow-wrap:anywhere]"
          >
            <Button
              variant="link"
              className="h-auto max-w-full p-0 text-start whitespace-normal"
              render={
                <Link
                  to="/app/projects/$organizationId/$projectId"
                  params={{ organizationId, projectId: item.projectId }}
                />
              }
            >
              {item.projectName}
            </Button>
            <p className="text-sm">
              {item.kind === "project_attachment"
                ? t("referenceAttachment")
                : t("referenceRichText", { locale: item.locale })}
            </p>
            <Button
              variant="link"
              className="h-auto max-w-full p-0 text-start whitespace-normal"
              render={
                <Link
                  to="/app/files/$organizationId/entries/$entryId"
                  params={{ organizationId, entryId: item.fileId }}
                  search={{ versionId: item.versionId }}
                />
              }
            >
              {t("referenceVersion", { id: item.versionId })}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
