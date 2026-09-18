import { useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  ApiClientError,
  getProjectTranslationOptions,
  createProjectMutations,
} from "@workspace/api-client"
import {
  ProjectStatusSchema,
  SupportedLocaleSchema,
  type ProjectResponse,
  type SupportedLocale,
} from "@workspace/contracts"
import { localeMeta } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { FormDialog, LoadingState, LocaleSwitcher } from "@workspace/admin"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Textarea } from "@workspace/ui/components/textarea"
import { z } from "zod"

type ProjectEditProps = {
  organizationId: string
  project: ProjectResponse
}

const contentLocales = ["zh-CN", "en-US", "ar"] as const

export function ProjectEdit({ organizationId, project }: ProjectEditProps) {
  const { t } = useTranslation(["projects", "common", "validation"])
  const [open, setOpen] = useState(false)
  const [targetLocale, setTargetLocale] = useState<SupportedLocale>(
    project.contentLocale
  )
  const translation = useQuery({
    ...getProjectTranslationOptions(organizationId, project.id, targetLocale),
    enabled: open,
  })
  const missingTranslation =
    translation.error instanceof ApiClientError &&
    translation.error.body.code === "NOT_FOUND"

  return (
    <>
      <Button onClick={() => setOpen(true)}>{t("projects:edit")}</Button>
      {open && translation.isPending && (
        <FormDialog
          open={open}
          onOpenChange={setOpen}
          title={t("projects:edit")}
          description={t("projects:editDescription")}
          onSubmit={() => undefined}
          pending
        >
          <LoadingState />
        </FormDialog>
      )}
      {open && !translation.isPending && missingTranslation && (
        <ProjectEditForm
          key={targetLocale}
          organizationId={organizationId}
          project={project}
          targetLocale={targetLocale}
          onTargetLocaleChange={setTargetLocale}
          initial={{ name: "", description: null }}
          onOpenChange={setOpen}
        />
      )}
      {open && !translation.isPending && translation.data && (
        <ProjectEditForm
          key={targetLocale}
          organizationId={organizationId}
          project={project}
          targetLocale={targetLocale}
          onTargetLocaleChange={setTargetLocale}
          initial={translation.data.data}
          onOpenChange={setOpen}
        />
      )}
      {open &&
        !translation.isPending &&
        !translation.data &&
        !missingTranslation && (
          <FormDialog
            open={open}
            onOpenChange={setOpen}
            title={t("projects:edit")}
            description={t("projects:editDescription")}
            onSubmit={() => undefined}
            error={t("common:operationFailed")}
          >
            <p role="status">{t("projects:translationLoadFailed")}</p>
          </FormDialog>
        )}
    </>
  )
}

export function ProjectEditForm({
  organizationId,
  project,
  targetLocale,
  onTargetLocaleChange,
  initial,
  onOpenChange,
}: ProjectEditProps & {
  targetLocale: SupportedLocale
  onTargetLocaleChange: (locale: SupportedLocale) => void
  initial: { name: string; description: string | null }
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation(["projects", "common", "validation"])
  const uiLocale = useUiLocale()
  const queryClient = useQueryClient()
  const mutations = createProjectMutations(
    queryClient,
    organizationId,
    uiLocale
  )
  const [failed, setFailed] = useState(false)
  const schema = editSchema(initial, t("validation:projectName"))
  const form = useForm({
    defaultValues: {
      targetLocale,
      status: project.status,
      name: initial.name,
      description: initial.description ?? "",
    },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      const description = value.description === "" ? null : value.description
      const translationChanged =
        value.name !== initial.name || description !== initial.description
      const statusChanged = value.status !== project.status
      if (!translationChanged && !statusChanged) {
        onOpenChange(false)
        return
      }
      setFailed(false)
      let committed: Awaited<ReturnType<typeof mutations.update>>
      try {
        committed = await mutations.update(project.id, {
          ...(statusChanged ? { status: value.status } : {}),
          ...(translationChanged
            ? {
                translation: {
                  locale: value.targetLocale,
                  name: value.name.trim(),
                  description,
                },
              }
            : {}),
        })
      } catch {
        setFailed(true)
        return
      }
      await committed.refreshed
      onOpenChange(false)
    },
  })

  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(pending) => (
        <FormDialog
          open
          onOpenChange={onOpenChange}
          title={t("projects:edit")}
          description={t("projects:editDescription")}
          onSubmit={() => void form.handleSubmit()}
          pending={pending}
          error={failed ? t("common:operationFailed") : undefined}
          submitLabel={t("projects:save")}
        >
          <FieldGroup>
            <LocaleSwitcher variant="select" className="w-full" />
            <form.Field name="targetLocale">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor="project-edit-content-locale">
                      {t("projects:targetLocale")}
                    </FieldLabel>
                    <Select
                      value={field.state.value}
                      items={Object.fromEntries(
                        contentLocales.map((locale) => [
                          locale,
                          localeMeta[locale].label,
                        ])
                      )}
                      onValueChange={(value) => {
                        const locale = SupportedLocaleSchema.parse(value)
                        field.handleChange(locale)
                        onTargetLocaleChange(locale)
                      }}
                    >
                      <SelectTrigger
                        id="project-edit-content-locale"
                        onBlur={field.handleBlur}
                        aria-invalid={invalid}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {contentLocales.map((locale) => (
                          <SelectItem key={locale} value={locale}>
                            {localeMeta[locale].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {invalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                )
              }}
            </form.Field>
            <form.Field name="status">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor="project-edit-status">
                      {t("projects:status")}
                    </FieldLabel>
                    <Select
                      value={field.state.value}
                      items={{
                        draft: t("projects:draft"),
                        active: t("projects:active"),
                        archived: t("projects:archived"),
                      }}
                      onValueChange={(value) =>
                        field.handleChange(ProjectStatusSchema.parse(value))
                      }
                    >
                      <SelectTrigger
                        id="project-edit-status"
                        onBlur={field.handleBlur}
                        aria-invalid={invalid}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">
                          {t("projects:draft")}
                        </SelectItem>
                        <SelectItem value="active">
                          {t("projects:active")}
                        </SelectItem>
                        <SelectItem value="archived">
                          {t("projects:archived")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {invalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                )
              }}
            </form.Field>
            <form.Field name="name">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor="project-edit-name">
                      {t("projects:name")}
                    </FieldLabel>
                    <Input
                      id="project-edit-name"
                      name={field.name}
                      value={field.state.value}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      onBlur={field.handleBlur}
                      aria-invalid={invalid}
                    />
                    {invalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                )
              }}
            </form.Field>
            <form.Field name="description">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="project-edit-description">
                    {t("projects:description")}
                  </FieldLabel>
                  <Textarea
                    id="project-edit-description"
                    name={field.name}
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                  />
                </Field>
              )}
            </form.Field>
          </FieldGroup>
        </FormDialog>
      )}
    </form.Subscribe>
  )
}

function editSchema(
  initial: { name: string; description: string | null },
  nameError: string
) {
  return z
    .object({
      targetLocale: SupportedLocaleSchema,
      status: ProjectStatusSchema,
      name: z.string(),
      description: z.string(),
    })
    .superRefine((value, context) => {
      const description = value.description === "" ? null : value.description
      const translationChanged =
        value.name !== initial.name || description !== initial.description
      if (translationChanged && value.name.trim().length === 0)
        context.addIssue({ code: "custom", message: nameError, path: ["name"] })
    })
}
