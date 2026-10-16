import { WebhookDeliveries } from "./webhook-deliveries"
import { useEffect, useId, useRef, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import {
  LoadingState,
  ErrorState,
  EmptyState,
  PermissionDeniedState,
  FormDialog,
  ConfirmDangerAction,
} from "@workspace/admin"
import {
  ApiClientError,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  listWebhooks,
  organizationKeys,
  requestLanguageHeader,
} from "@workspace/api-client"
import {
  CreateWebhookSchema,
  UpdateWebhookSchema,
  WebhookSchema,
  CreatedWebhookSchema,
  WebhookListSchema,
  WebhookEventTypeSchema,
  webhookEventTypes,
} from "@workspace/contracts/framework-capabilities"
import { useUiLocale } from "@workspace/i18n/react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Badge } from "@workspace/ui/components/badge"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
} from "@workspace/ui/components/field"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
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
import { authClient } from "@/lib/auth-client"
import { useOrganizationAuthorization } from "@/hooks/use-organization-authorization"

type Endpoint = ReturnType<typeof WebhookSchema.parse>
type WebhookEventType = ReturnType<typeof WebhookEventTypeSchema.parse>
export function WebhooksSettings({
  organizationId,
}: {
  organizationId: string
}) {
  const user = useAuthenticatedSession()?.user
  return user ? (
    <WebhookAuthority
      key={`${organizationId}:${user.id}`}
      organizationId={organizationId}
      userId={user.id}
    />
  ) : null
}
function WebhookAuthority({
  organizationId,
  userId,
}: {
  organizationId: string
  userId: string
}) {
  const access = useOrganizationAuthorization({
    organizationId,
    userId,
    observation: "webhooks",
  })
  if (access.isError)
    return (
      <ErrorState
        message={access.error.message}
        onRetry={() => void access.refetch()}
      />
    )
  if (access.isPending) return <LoadingState />
  return (
    <WebhookScope
      key={access.data.scopeKey}
      organizationId={organizationId}
      userId={userId}
      version={access.data.authorizationVersion}
    />
  )
}
function WebhookScope({
  organizationId,
  userId,
  version,
}: {
  organizationId: string
  userId: string
  version: number
}) {
  const locale = useUiLocale()
  const permissions = useQuery({
    queryKey: [
      ...organizationKeys.scope(organizationId),
      "webhook-permissions",
      userId,
      version,
    ],
    retry: false,
    queryFn: async ({ signal }) => {
      const check = async (action: "read" | "manage") => {
        const response = await authClient.organization.hasPermission({
          organizationId,
          permissions: { integration: [action] },
          fetchOptions: { signal },
        })
        if (response.error) throw new Error(response.error.message)
        return response.data.success
      }
      const [canRead, canManage] = await Promise.all([
        check("read"),
        check("manage"),
      ])
      return { canRead, canManage }
    },
  })
  const prefix = [
    ...organizationKeys.scope(organizationId),
    "webhooks",
    userId,
    version,
  ]
  const query = useQuery({
    queryKey: [...prefix, locale],
    retry: false,
    enabled: permissions.isSuccess && permissions.data.canRead,
    queryFn: async ({ signal }) =>
      WebhookListSchema.parse(
        (
          await listWebhooks(organizationId, {
            signal,
            headers: { [requestLanguageHeader]: locale },
          })
        ).data
      ),
  })
  if (permissions.isError)
    return (
      <ErrorState
        message={permissions.error.message}
        onRetry={() => void permissions.refetch()}
      />
    )
  if (permissions.isPending) return <LoadingState />
  if (!permissions.data.canRead) return <PermissionDeniedState />
  if (query.isError)
    return (
      <ErrorState
        message={query.error.message}
        onRetry={() => void query.refetch()}
      />
    )
  if (query.isPending) return <LoadingState />
  return (
    <WebhookManager
      organizationId={organizationId}
      userId={userId}
      version={version}
      canManage={permissions.data.canManage}
      items={query.data}
    />
  )
}
function WebhookManager({
  organizationId,
  userId,
  version,
  canManage,
  items,
}: {
  organizationId: string
  userId: string
  version: number
  canManage: boolean
  items: Endpoint[]
}) {
  const { t } = useTranslation(["webhooks", "common", "errors"])
  const locale = useUiLocale()
  const client = useQueryClient()
  const prefix = [
    ...organizationKeys.scope(organizationId),
    "webhooks",
    userId,
    version,
  ]
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Endpoint | null>(null)
  const [history, setHistory] = useState<Endpoint | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle")
  const deletion = useMutation({
    retry: false,
    mutationFn: async (id: string) =>
      deleteWebhook(organizationId, id, {
        headers: { [requestLanguageHeader]: locale },
      }),
    onSuccess: () => {
      setDeleting(null)
      void client.invalidateQueries({ queryKey: prefix })
    },
  })
  const reload = () => void client.invalidateQueries({ queryKey: prefix })
  const events = {
    "project.created": t("webhooks:projectCreated"),
    "project.updated": t("webhooks:projectUpdated"),
    "project.deleted": t("webhooks:projectDeleted"),
    "task.completed": t("webhooks:taskCompleted"),
    "task.failed": t("webhooks:taskFailed"),
  }
  return (
    <section
      className="space-y-4"
      aria-labelledby={`webhooks-${organizationId}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`webhooks-${organizationId}`} className="text-xl font-semibold">
          {t("webhooks:title")}
        </h2>
        {canManage && (
          <Button onClick={() => setCreating(true)}>
            {t("webhooks:create")}
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {t("webhooks:description")}
      </p>
      {items.length === 0 ? (
        <EmptyState />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("webhooks:name")}</TableHead>
              <TableHead>{t("webhooks:destination")}</TableHead>
              <TableHead>{t("webhooks:events")}</TableHead>
              <TableHead>{t("webhooks:status")}</TableHead>
              <TableHead>
                <span className="sr-only">{t("webhooks:edit")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{item.name}</TableCell>
                <TableCell className="max-w-80 break-all whitespace-normal">
                  {item.url}
                </TableCell>
                <TableCell className="whitespace-normal">
                  {item.events.map((event) => (
                    <p key={event}>{events[event]}</p>
                  ))}
                </TableCell>
                <TableCell>
                  <Badge variant={item.enabled ? "default" : "secondary"}>
                    {item.enabled
                      ? t("webhooks:enabled")
                      : t("webhooks:disabled")}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setHistory(item)}
                    >
                      {t("webhooks:history")}
                    </Button>
                    {canManage && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditing(item)}
                        >
                          {t("webhooks:edit")}
                        </Button>
                        <ConfirmDangerAction
                          triggerLabel={t("webhooks:delete")}
                          title={t("webhooks:delete")}
                          description={t("webhooks:deleteHint")}
                          cancelLabel={t("common:cancel")}
                          confirmLabel={t("webhooks:delete")}
                          pendingLabel={t("webhooks:deleting")}
                          open={deleting === item.id}
                          onOpenChange={(open) => {
                            setDeleting(open ? item.id : null)
                            deletion.reset()
                          }}
                          pending={deletion.isPending}
                          onConfirm={() => deletion.mutate(item.id)}
                          error={
                            deletion.error
                              ? deletion.error instanceof ApiClientError
                                ? deletion.error.body.message
                                : t("errors:INTERNAL_ERROR")
                              : undefined
                          }
                        />
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {creating && (
        <WebhookForm
          endpoint={null}
          onUpdated={() => {}}
          organizationId={organizationId}
          onClose={() => setCreating(false)}
          onCreated={(value) => {
            setCreating(false)
            setCopy("idle")
            setSecret(value.signingSecret)
            reload()
          }}
        />
      )}
      {history && (
        <WebhookDeliveries
          organizationId={organizationId}
          userId={userId}
          version={version}
          webhookId={history.id}
          name={history.name}
          onClose={() => setHistory(null)}
        />
      )}
      {editing && (
        <WebhookForm
          endpoint={editing}
          organizationId={organizationId}
          onClose={() => setEditing(null)}
          onCreated={() => {}}
          onUpdated={() => {
            setEditing(null)
            reload()
          }}
        />
      )}
      {secret && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setSecret(null)
          }}
        >
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>{t("webhooks:secretTitle")}</DialogTitle>
              <DialogDescription>{t("webhooks:secretHint")}</DialogDescription>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor={`secret-${organizationId}`}>
                {t("webhooks:signingSecret")}
              </FieldLabel>
              <Input
                id={`secret-${organizationId}`}
                value={secret}
                readOnly
                className="font-mono"
              />
            </Field>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(secret)
                    .then(() => setCopy("copied"))
                    .catch(() => setCopy("failed"))
                }}
              >
                {t("webhooks:copySecret")}
              </Button>
              {copy === "copied" && <p role="status">{t("webhooks:copied")}</p>}
              {copy === "failed" && (
                <p role="alert">{t("webhooks:copyFailed")}</p>
              )}
            </div>
            <DialogFooter>
              <Button onClick={() => setSecret(null)}>
                {t("common:close")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}
function webhookFormSchema(messages: {
  nameRequired: string
  urlRequired: string
  eventsRequired: string
}) {
  return z.strictObject({
    name: z.string().trim().min(1, messages.nameRequired),
    url: z
      .url({ error: messages.urlRequired })
      .refine(
        (value) => ["http:", "https:"].includes(new URL(value).protocol),
        messages.urlRequired
      ),
    events: z.array(WebhookEventTypeSchema).min(1, messages.eventsRequired),
    enabled: z.boolean(),
  })
}
function WebhookForm({
  organizationId,
  onClose,
  onCreated,
  endpoint,
  onUpdated,
}: {
  organizationId: string
  endpoint: Endpoint | null
  onUpdated: () => void
  onClose: () => void
  onCreated: (value: ReturnType<typeof CreatedWebhookSchema.parse>) => void
}) {
  const { t } = useTranslation(["webhooks", "errors"])
  const locale = useUiLocale()
  const id = useId()
  const active = useRef<AbortController | null>(null)
  useEffect(() => () => active.current?.abort(), [])

  const mutation = useMutation({
    gcTime: 0,
    retry: false,
    mutationFn: async (value: {
      name: string
      url: string
      events: WebhookEventType[]
      enabled: boolean
    }) => {
      const controller = new AbortController()
      active.current = controller
      const options = {
        signal: controller.signal,
        headers: { [requestLanguageHeader]: locale },
      }
      if (endpoint) {
        const response = await updateWebhook(
          organizationId,
          endpoint.id,
          UpdateWebhookSchema.parse(value),
          options
        )
        controller.signal.throwIfAborted()
        return {
          kind: "update" as const,
          item: WebhookSchema.parse(response.data),
        }
      }
      const response = await createWebhook(
        organizationId,
        CreateWebhookSchema.parse({
          name: value.name,
          url: value.url,
          events: value.events,
        }),
        options
      )
      controller.signal.throwIfAborted()
      return {
        kind: "create" as const,
        item: CreatedWebhookSchema.parse(response.data),
      }
    },
  })
  const schema = webhookFormSchema({
    nameRequired: t("webhooks:nameRequired"),
    urlRequired: t("webhooks:urlRequired"),
    eventsRequired: t("webhooks:eventsRequired"),
  })
  const form = useForm({
    defaultValues: {
      name: endpoint?.name ?? "",
      url: endpoint?.url ?? "",
      events: endpoint?.events ?? ([] as WebhookEventType[]),
      enabled: endpoint?.enabled ?? true,
    },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      try {
        const response = await mutation.mutateAsync(value)
        if (response.kind === "create") onCreated(response.item)
        else onUpdated()
        mutation.reset()
      } catch {
        /* 失败保留原表单输入；创建密钥不写入metadata缓存。 */
      }
    },
  })
  const events = {
    "project.created": t("webhooks:projectCreated"),
    "project.updated": t("webhooks:projectUpdated"),
    "project.deleted": t("webhooks:projectDeleted"),
    "task.completed": t("webhooks:taskCompleted"),
    "task.failed": t("webhooks:taskFailed"),
  }
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(pending) => (
        <FormDialog
          open
          onOpenChange={(open) => {
            if (!open) onClose()
          }}
          title={endpoint ? t("webhooks:edit") : t("webhooks:create")}
          description={t("webhooks:description")}
          pending={pending}
          onSubmit={() => void form.handleSubmit()}
          submitLabel={t("webhooks:save")}
          error={
            mutation.error
              ? mutation.error instanceof ApiClientError
                ? mutation.error.body.message
                : t("errors:INTERNAL_ERROR")
              : undefined
          }
        >
          <FieldGroup>
            <form.Field name="name">
              {(field) => (
                <Field
                  data-invalid={
                    field.state.meta.isTouched && !field.state.meta.isValid
                  }
                >
                  <FieldLabel htmlFor={`${id}-name`}>
                    {t("webhooks:name")}
                  </FieldLabel>
                  <Input
                    id={`${id}-name`}
                    required
                    aria-invalid={
                      field.state.meta.isTouched && !field.state.meta.isValid
                    }
                    disabled={pending}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  {field.state.meta.isTouched && !field.state.meta.isValid && (
                    <FieldError errors={field.state.meta.errors} />
                  )}
                </Field>
              )}
            </form.Field>
            <form.Field name="url">
              {(field) => (
                <Field
                  data-invalid={
                    field.state.meta.isTouched && !field.state.meta.isValid
                  }
                >
                  <FieldLabel htmlFor={`${id}-url`}>
                    {t("webhooks:destination")}
                  </FieldLabel>
                  <Input
                    id={`${id}-url`}
                    type="url"
                    required
                    aria-invalid={
                      field.state.meta.isTouched && !field.state.meta.isValid
                    }
                    disabled={pending}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  {field.state.meta.isTouched && !field.state.meta.isValid && (
                    <FieldError errors={field.state.meta.errors} />
                  )}
                </Field>
              )}
            </form.Field>
            <form.Field name="events" mode="array">
              {(field) => (
                <Field
                  data-invalid={
                    field.state.meta.isTouched && !field.state.meta.isValid
                  }
                >
                  <FieldLabel>{t("webhooks:events")}</FieldLabel>
                  <FieldGroup data-slot="checkbox-group">
                    {webhookEventTypes.map((event) => (
                      <Field key={event} orientation="horizontal">
                        <Checkbox
                          id={`${id}-${event}`}
                          aria-invalid={
                            field.state.meta.isTouched &&
                            !field.state.meta.isValid
                          }
                          disabled={pending}
                          checked={field.state.value.includes(event)}
                          onBlur={field.handleBlur}
                          onCheckedChange={(checked) => {
                            if (checked) field.pushValue(event)
                            else
                              field.removeValue(
                                field.state.value.indexOf(event)
                              )
                          }}
                        />
                        <FieldLabel htmlFor={`${id}-${event}`}>
                          {events[event]}
                        </FieldLabel>
                      </Field>
                    ))}
                  </FieldGroup>
                  {field.state.meta.isTouched && !field.state.meta.isValid && (
                    <FieldError errors={field.state.meta.errors} />
                  )}
                </Field>
              )}
            </form.Field>
            {endpoint && (
              <form.Field name="enabled">
                {(field) => (
                  <Field orientation="horizontal">
                    <Checkbox
                      id={`${id}-enabled`}
                      disabled={pending}
                      checked={field.state.value}
                      onCheckedChange={field.handleChange}
                    />
                    <FieldLabel htmlFor={`${id}-enabled`}>
                      {t("webhooks:enableDelivery")}
                    </FieldLabel>
                  </Field>
                )}
              </form.Field>
            )}
          </FieldGroup>
        </FormDialog>
      )}
    </form.Subscribe>
  )
}
