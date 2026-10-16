import { z } from "zod"
import { SupportedLocaleSchema } from "./locale.js"
import { OrganizationIdSchema } from "./identifiers.js"
import { ProjectStatusSchema } from "./project-query.js"
import {
  ProjectAttachmentsSchema,
  UpdateProjectAttachmentsSchema,
  ProjectRichTextDocumentSchema,
} from "./project-files.js"

export * from "./project-query.js"

export const ProjectContentResponseSchema = z
  .strictObject({
    locale: SupportedLocaleSchema,
    revision: z.number().int().min(1).nullable(),
    document: ProjectRichTextDocumentSchema.nullable(),
    updatedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: "ProjectContentResponse" })
export type ProjectContentResponse = z.infer<
  typeof ProjectContentResponseSchema
>
export const CreateProjectSchema = z
  .strictObject({
    name: z.string().trim().min(1),
    description: z.string().nullable(),
    contentLocale: SupportedLocaleSchema.optional(),
    attachments: ProjectAttachmentsSchema.optional(),
  })
  .meta({ id: "CreateProject" })
export type CreateProject = z.infer<typeof CreateProjectSchema>
export const UpdateProjectTranslationSchema = z
  .strictObject({
    locale: SupportedLocaleSchema,
    name: z.string().trim().min(1).optional(),
    description: z.string().nullable().optional(),
  })
  .refine(
    (translation) =>
      translation.name !== undefined || translation.description !== undefined,
    { message: "At least one translation field is required" }
  )
  .meta({ id: "UpdateProjectTranslation" })
export type UpdateProjectTranslation = z.infer<
  typeof UpdateProjectTranslationSchema
>
export const UpdateProjectSchema = z
  .strictObject({
    status: ProjectStatusSchema.optional(),
    translation: UpdateProjectTranslationSchema.optional(),
    attachments: UpdateProjectAttachmentsSchema.optional(),
  })
  .refine(
    (project) =>
      project.status !== undefined ||
      project.translation !== undefined ||
      project.attachments !== undefined,
    { message: "At least one project field is required" }
  )
  .meta({ id: "UpdateProject" })
export type UpdateProject = z.infer<typeof UpdateProjectSchema>
export const ProjectTranslationResponseSchema = z
  .strictObject({
    locale: SupportedLocaleSchema,
    name: z.string().min(1),
    description: z.string().nullable(),
  })
  .meta({ id: "ProjectTranslationResponse" })
export type ProjectTranslationResponse = z.infer<
  typeof ProjectTranslationResponseSchema
>
export const ProjectResponseSchema = z
  .strictObject({
    id: z.uuid(),
    organizationId: OrganizationIdSchema,
    status: ProjectStatusSchema,
    contentLocale: SupportedLocaleSchema,
    resolvedLocale: SupportedLocaleSchema,
    name: z.string().min(1),
    description: z.string().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "ProjectResponse" })
export type ProjectResponse = z.infer<typeof ProjectResponseSchema>
export const ProjectPageSchema = z
  .strictObject({
    items: z.array(ProjectResponseSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
  })
  .meta({ id: "ProjectPage" })
export type ProjectPage = z.infer<typeof ProjectPageSchema>
