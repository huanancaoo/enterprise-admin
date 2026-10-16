import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  listWebhookDeliveries,
  organizationKeys,
  requestLanguageHeader,
} from "@workspace/api-client"
import { WebhookDeliveryPageSchema } from "@workspace/contracts/framework-capabilities"
import {
  LoadingState,
  EmptyState,
  ErrorState,
  Pagination,
} from "@workspace/admin"
import { useUiLocale } from "@workspace/i18n/react"
import { createFormatter } from "@workspace/i18n"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@workspace/ui/components/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
export function WebhookDeliveries({
  organizationId,
  webhookId,
  userId,
  version,
  name,
  onClose,
}: {
  organizationId: string
  webhookId: string
  userId: string
  version: number
  name: string
  onClose: () => void
}) {
  const { t } = useTranslation(["webhooks", "common"])
  const locale = useUiLocale()
  const format = createFormatter(locale)
  const [page, setPage] = useState({ page: 1, pageSize: 20 })
  const query = useQuery({
    queryKey: [
      ...organizationKeys.scope(organizationId),
      "webhooks",
      userId,
      version,
      "deliveries",
      webhookId,
      locale,
      page,
    ],
    retry: false,
    queryFn: async ({ signal }) =>
      WebhookDeliveryPageSchema.parse(
        (
          await listWebhookDeliveries(organizationId, webhookId, page, {
            signal,
            headers: { [requestLanguageHeader]: locale },
          })
        ).data
      ),
    refetchInterval: (q) =>
      q.state.error
        ? false
        : q.state.data?.items.some((item) => item.status === "pending")
          ? 1000
          : false,
  })
  const events = {
    "project.created": t("webhooks:projectCreated"),
    "project.updated": t("webhooks:projectUpdated"),
    "project.deleted": t("webhooks:projectDeleted"),
    "task.completed": t("webhooks:taskCompleted"),
    "task.failed": t("webhooks:taskFailed"),
  }
  const states = {
    pending: t("webhooks:pending"),
    delivered: t("webhooks:delivered"),
    failed: t("webhooks:failed"),
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("webhooks:history")}</DialogTitle>
          <DialogDescription>{name}</DialogDescription>
        </DialogHeader>
        {query.isError ? (
          <ErrorState
            message={query.error.message}
            onRetry={() => void query.refetch()}
          />
        ) : query.isPending ? (
          <LoadingState />
        ) : (
          <>
            {query.data.items.length === 0 ? (
              <EmptyState />
            ) : (
              <Table tabIndex={0} aria-label={t("webhooks:history")}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("webhooks:event")}</TableHead>
                    <TableHead>{t("webhooks:status")}</TableHead>
                    <TableHead>{t("webhooks:attempts")}</TableHead>
                    <TableHead>{t("webhooks:httpStatus")}</TableHead>
                    <TableHead>{t("webhooks:nextAttempt")}</TableHead>
                    <TableHead>{t("webhooks:createdAt")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="whitespace-normal">
                        <p>{events[item.eventType]}</p>
                        <p className="text-xs break-all text-muted-foreground">
                          {item.eventId}
                        </p>
                      </TableCell>
                      <TableCell>{states[item.status]}</TableCell>
                      <TableCell>{format.number(item.attempts)}</TableCell>
                      <TableCell>
                        {item.lastStatusCode === null
                          ? "—"
                          : String(item.lastStatusCode)}
                      </TableCell>
                      <TableCell>
                        {item.nextAttemptAt
                          ? format.dateTime(
                              new Date(item.nextAttemptAt),
                              "UTC",
                              { dateStyle: "short", timeStyle: "short" }
                            )
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {format.dateTime(new Date(item.createdAt), "UTC", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <Pagination
              pageIndex={page.page - 1}
              pageSize={page.pageSize}
              rowCount={query.data.total}
              pageCount={Math.max(
                1,
                Math.ceil(query.data.total / page.pageSize)
              )}
              onPageChange={(index) => setPage({ ...page, page: index + 1 })}
              onPageSizeChange={(pageSize) => setPage({ page: 1, pageSize })}
            />
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common:close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
