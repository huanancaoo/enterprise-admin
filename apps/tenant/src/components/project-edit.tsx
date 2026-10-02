import {
  attachmentReferences,
  useProjectAttachmentAccess,
} from "./project-attachment-access"
import { useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  ApiClientError,
  getProjectTranslationOptions,
  createProjectMutations,
  getProjectAttachmentsOptions,
  organizationKeys,
} from "@workspace/api-client"
import {
  ProjectStatusSchema,
  ProjectAttachmentSchema,
  type ProjectAttachment,
  type ProjectAttachmentsResponse,
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
import { ProjectAttachmentsField } from "./project-attachments"

type ProjectEditProps = {
  organizationId: string
  project: ProjectResponse
}

type AttachmentDraft = {
  baseline: ProjectAttachmentsResponse
  items: ProjectAttachment[]
  expectedRevision: number
}
const contentLocales = ["zh-CN", "en-US", "ar"] as const

export function ProjectEdit({ organizationId, project }: ProjectEditProps) {
  const { t } = useTranslation(["projects", "common", "validation"])
  const [open, setOpen] = useState(false)
  const [openingVersion, setOpeningVersion] = useState(0)
  const uiLocale = useUiLocale()
  const access = useProjectAttachmentAccess(organizationId)
  const [attachmentDraft, setAttachmentDraft] = useState<AttachmentDraft>()
  const attachments = useQuery({
    ...getProjectAttachmentsOptions(
      organizationId,
      project.id,
      openingVersion,
      uiLocale
    ),
    // 初始读回是本次编辑的 CAS 基线；后续授权变化不卸载已输入的草稿。
    enabled: open && access.active,
  })
  const close = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) setAttachmentDraft(undefined)
  }
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
      <Button
        disabled={!access.canUpdate && !access.canTranslate}
        onClick={() => {
          setOpeningVersion(access.authorizationVersion)
          setOpen(true)
        }}
      >
        {t("projects:edit")}
      </Button>
      {open &&
        (translation.isPending || attachments.isPending) &&
        !access.error && (
          <FormDialog
            open={open}
            onOpenChange={close}
            title={t("projects:edit")}
            description={t("projects:editDescription")}
            onSubmit={() => undefined}
            pending
          >
            <LoadingState />
          </FormDialog>
        )}
      {open &&
        !translation.isPending &&
        attachments.data &&
        missingTranslation && (
          <ProjectEditForm
            key={targetLocale}
            organizationId={organizationId}
            project={project}
            targetLocale={targetLocale}
            onTargetLocaleChange={setTargetLocale}
            initial={{ name: "", description: null }}
            attachments={attachments.data}
            attachmentDraft={attachmentDraft}
            onAttachmentDraftChange={setAttachmentDraft}
            onOpenChange={close}
          />
        )}
      {open &&
        !translation.isPending &&
        attachments.data &&
        translation.data && (
          <ProjectEditForm
            key={targetLocale}
            organizationId={organizationId}
            project={project}
            targetLocale={targetLocale}
            onTargetLocaleChange={setTargetLocale}
            initial={translation.data.data}
            attachments={attachments.data}
            attachmentDraft={attachmentDraft}
            onAttachmentDraftChange={setAttachmentDraft}
            onOpenChange={close}
          />
        )}
      {open &&
        !translation.isPending &&
        !attachments.isPending &&
        ((!attachments.data && (attachments.isError || !!access.error)) ||
          (!translation.data && !missingTranslation)) && (
          <FormDialog
            open={open}
            onOpenChange={close}
            title={t("projects:edit")}
            description={t("projects:editDescription")}
            onSubmit={() => undefined}
            error={
              attachments.error instanceof ApiClientError
                ? attachments.error.body.message
                : t("common:operationFailed")
            }
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
  attachments,
  attachmentDraft,
  onAttachmentDraftChange,
}: ProjectEditProps & {
  targetLocale: SupportedLocale
  onTargetLocaleChange: (locale: SupportedLocale) => void
  initial: { name: string; description: string | null }
  onOpenChange: (open: boolean) => void
  attachments: ProjectAttachmentsResponse
  attachmentDraft?: AttachmentDraft
  onAttachmentDraftChange?: (draft: AttachmentDraft) => void
}) {
  const { t } = useTranslation(["projects", "common", "validation"])
  const uiLocale = useUiLocale()
  const queryClient = useQueryClient()
  const mutations = createProjectMutations(
    queryClient,
    organizationId,
    uiLocale
  )
  const access = useProjectAttachmentAccess(organizationId)
  // 草稿的比较基线固定于开始编辑；后台读回不会把未修改字段变成覆盖请求。
  const [translationBaseline] = useState(initial)
  const [statusBaseline] = useState(project.status)
  const [attachmentBaseline, setAttachmentBaseline] = useState(
    attachmentDraft?.baseline ?? attachments
  )
  const [failure, setFailure] = useState<string>()
  const [conflict, setConflict] = useState(false)
  const [refreshingRevision, setRefreshingRevision] = useState(false)
  const schema = editSchema(translationBaseline, t("validation:projectName"))
  const form = useForm({
    defaultValues: {
      targetLocale,
      status: statusBaseline,
      name: translationBaseline.name,
      description: translationBaseline.description ?? "",
      attachments: attachmentDraft?.items ?? attachments.items,
      expectedRevision:
        attachmentDraft?.expectedRevision ?? attachments.revision,
    },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      const description = value.description === "" ? null : value.description
      const translationChanged =
        value.name !== translationBaseline.name ||
        description !== translationBaseline.description
      const statusChanged = value.status !== statusBaseline
      const attachmentsChanged =
        JSON.stringify(attachmentReferences(value.attachments)) !==
        JSON.stringify(attachmentReferences(attachmentBaseline.items))
      if (!translationChanged && !statusChanged && !attachmentsChanged) {
        onOpenChange(false)
        return
      }
      setFailure(undefined)
      setConflict(false)
      let committed: Awaited<ReturnType<typeof mutations.update>>
      try {
        committed = await mutations.update(project.id, {
          ...(attachmentsChanged
            ? {
                attachments: {
                  expectedRevision: value.expectedRevision,
                  items: attachmentReferences(value.attachments),
                },
              }
            : {}),
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
      } catch (error) {
        const isConflict =
          error instanceof ApiClientError &&
          error.body.code === "VERSION_CONFLICT"
        setConflict(isConflict)
        setFailure(
          isConflict
            ? t("projects:attachmentConflict")
            : t("common:operationFailed")
        )
        if (error instanceof ApiClientError && error.status === 403)
          void queryClient.invalidateQueries({
            queryKey: organizationKeys.access(organizationId),
          })
        return
      }
      await committed.refreshed
      onOpenChange(false)
    },
  })

  const refreshRevision = async () => {
    setRefreshingRevision(true)
    try {
      const latest = await queryClient.query({
        ...getProjectAttachmentsOptions(
          organizationId,
          project.id,
          access.authorizationVersion,
          uiLocale
        ),
        staleTime: 0,
      })
      // 只有显式刷新才采用最新修订；文字与附件草稿保留，下一次保存仍需用户提交。
      setAttachmentBaseline(latest)
      form.setFieldValue("expectedRevision", latest.revision)
      setConflict(false)
      setFailure(undefined)
    } catch (error) {
      setFailure(
        error instanceof ApiClientError
          ? error.body.message
          : t("common:operationFailed")
      )
    } finally {
      setRefreshingRevision(false)
    }
  }
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(pending) => (
        <FormDialog
          open
          onOpenChange={onOpenChange}
          title={t("projects:edit")}
          description={t("projects:editDescription")}
          onSubmit={() => void form.handleSubmit()}
          pending={pending || refreshingRevision}
          error={failure}
          submitDisabled={
            conflict || (!access.canUpdate && !access.canTranslate)
          }
          submitLabel={t("projects:save")}
        >
          <FieldGroup className="max-h-[60dvh] overflow-y-auto pe-1">
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
                        onAttachmentDraftChange?.({
                          baseline: attachmentBaseline,
                          items: form.getFieldValue("attachments"),
                          expectedRevision:
                            form.getFieldValue("expectedRevision"),
                        })
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
                      disabled={!access.canUpdate}
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
            <form.Field name="attachments" mode="array">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel>{t("projects:attachments")}</FieldLabel>
                    <ProjectAttachmentsField
                      organizationId={organizationId}
                      value={field.state.value}
                      access={access}
                      canChange={access.canUpdate}
                      onChange={(items) => {
                        field.handleChange(items)
                        field.handleBlur()
                      }}
                    />
                    {invalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                )
              }}
            </form.Field>
            {conflict && (
              <Button variant="outline" onClick={() => void refreshRevision()}>
                {t("projects:refreshAttachmentRevision")}
              </Button>
            )}
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
      attachments: z.array(ProjectAttachmentSchema),
      expectedRevision: z.number().int().min(1),
    })
    .superRefine((value, context) => {
      const description = value.description === "" ? null : value.description
      const translationChanged =
        value.name !== initial.name || description !== initial.description
      if (translationChanged && value.name.trim().length === 0)
        context.addIssue({ code: "custom", message: nameError, path: ["name"] })
    })
}
