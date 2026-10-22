import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { ErrorState, LoadingState } from "@workspace/admin"
import {
  type FileScope,
  referencesOptions,
  fileRequestErrorMessage,
} from "./queries"
export function FileReferenceLocations({
  scope,
  entryId,
}: {
  scope: FileScope
  entryId: string
}) {
  const { t } = useTranslation(["files", "common"]),
    query = useQuery(referencesOptions(scope, entryId))
  return (
    <section aria-label={t("files:referencesTitle")} className="space-y-3">
      <h2 className="font-semibold">{t("files:referencesTitle")}</h2>
      {query.isError ? (
        <ErrorState
          message={fileRequestErrorMessage(
            query.error,
            t("common:operationFailed")
          )}
          onRetry={() => void query.refetch()}
        />
      ) : !query.data ? (
        <LoadingState />
      ) : (
        <>
          <p>{t("files:referenceWarning", { references: query.data.total })}</p>
          <ul className="space-y-2">
            {query.data.items.map((item) => (
              <li
                key={JSON.stringify([
                  item.fileId,
                  item.versionId,
                  item.announcementId,
                ])}
              >
                <Link
                  className="text-primary underline"
                  to="/platform/announcements/$announcementId"
                  params={{ announcementId: item.announcementId }}
                >
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
