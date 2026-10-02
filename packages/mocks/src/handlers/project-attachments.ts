import { http, HttpResponse } from "msw"
import {
  maxOrganizationUploadBytes,
  FilePageSchema,
  FileResponseSchema,
  FileWorkspaceSchema,
  OrganizationAccessSchema,
  ProjectAttachmentSchema,
  ProjectAttachmentsResponseSchema,
  UpdateProjectSchema,
  type UpdateProject,
  type ProjectAttachment,
} from "@workspace/contracts"
import { organizations, projectFixtures } from "../fixtures/projects"
import { filePickerImage, filePickerRoot } from "./file-picker"

export const projectAttachmentRoot = {
  ...filePickerRoot,
  organizationId: organizations[0].id,
}
const content = "Fixed project attachment text"
export const projectAttachmentFile = FileResponseSchema.parse({
  ...filePickerImage,
  organizationId: organizations[0].id,
  parentId: projectAttachmentRoot.id,
  name: "Attachment.txt",
  path: ["Attachment.txt"],
  currentVersion: {
    ...filePickerImage.currentVersion,
    bytes: new TextEncoder().encode(content).length,
    contentType: "text/plain",
    previewKind: "text",
  },
})
export const projectAttachmentItem = ProjectAttachmentSchema.parse({
  fileId: projectAttachmentFile.id,
  versionId: projectAttachmentFile.currentVersion.id,
  name: projectAttachmentFile.name,
  bytes: projectAttachmentFile.currentVersion.bytes,
  contentType: projectAttachmentFile.currentVersion.contentType,
  versionCreatedAt: projectAttachmentFile.currentVersion.createdAt,
})

export function createProjectAttachmentsScenario(options?: {
  permission?: "all" | "translate" | "project-only"
  items?: ProjectAttachment[]
  edit?: "success" | "conflict"
}) {
  let revision = 1
  let items = options?.items ?? []
  let conflict = options?.edit === "conflict"
  const writes: UpdateProject[] = []
  const permission = options?.permission ?? "all"
  const permissions = {
    project:
      permission === "translate"
        ? ["read", "translate"]
        : ["read", "create", "update", "translate"],
    file: permission === "project-only" ? [] : ["read", "upload"],
    folder: permission === "project-only" ? [] : ["read"],
  }
  const failure = (
    status: number,
    code: "FORBIDDEN" | "VERSION_CONFLICT" | "NOT_FOUND"
  ) =>
    HttpResponse.json(
      {
        code,
        message: code,
        requestId: "storybook-project-attachment",
        locale: "zh-CN",
      },
      { status }
    )
  const handlers = [
    http.get("*/api/v1/organizations/:organizationId/access", ({ params }) =>
      HttpResponse.json(
        OrganizationAccessSchema.parse({
          organizationId: params.organizationId,
          status: "ACTIVE",
          authorizationVersion: 1,
          effectiveLocale: "zh-CN",
          effectiveLocaleSource: "organization",
        })
      )
    ),
    http.post("*/api/auth/organization/has-permission", async ({ request }) => {
      const input = (await request.json()) as {
        organizationId: string
        permissions: Record<string, string[]>
      }
      const success =
        input.organizationId === organizations[0].id &&
        Object.entries(input.permissions).every(([resource, actions]) =>
          actions.every((action) =>
            permissions[resource as keyof typeof permissions]?.includes(action)
          )
        )
      return HttpResponse.json({ success, error: null })
    }),
    http.get(
      "*/api/v1/organizations/:organizationId/projects/:projectId/attachments",
      () =>
        HttpResponse.json(
          ProjectAttachmentsResponseSchema.parse({ revision, items })
        )
    ),
    http.get("*/api/v1/organizations/:organizationId/files/workspace", () =>
      HttpResponse.json(
        FileWorkspaceSchema.parse({
          root: projectAttachmentRoot,
          usage: {
            quotaBytes: 10000000,
            usedBytes: 29,
            reservedBytes: 0,
            transientBytes: 0,
            trashDays: 30,
            historyDays: 30,
            policyRevision: 1,
            maxUploadBytes: maxOrganizationUploadBytes,
          },
        })
      )
    ),
    http.get(
      "*/api/v1/organizations/:organizationId/files/folders/:folderId/breadcrumbs",
      () => HttpResponse.json({ items: [projectAttachmentRoot] })
    ),
    http.get("*/api/v1/organizations/:organizationId/files", ({ request }) => {
      const search = new URL(request.url).searchParams.get("name")
      const selected =
        !search ||
        projectAttachmentFile.name.toLowerCase().includes(search.toLowerCase())
          ? [projectAttachmentFile]
          : []
      return HttpResponse.json(
        FilePageSchema.parse({
          items: selected,
          total: selected.length,
          page: 1,
          pageSize: 20,
        })
      )
    }),
    http.get(
      "*/api/v1/organizations/:organizationId/files/entries/:entryId",
      () =>
        permission === "project-only"
          ? failure(403, "FORBIDDEN")
          : HttpResponse.json(projectAttachmentFile)
    ),
    http.get(
      "*/api/v1/organizations/:organizationId/files/entries/:fileId/versions",
      () =>
        permission === "project-only"
          ? failure(403, "FORBIDDEN")
          : HttpResponse.json({ items: [projectAttachmentFile.currentVersion] })
    ),
    http.get(
      "*/api/v1/organizations/:organizationId/files/entries/:fileId/versions/:versionId/content",
      () =>
        permission === "project-only"
          ? failure(403, "FORBIDDEN")
          : new HttpResponse(content, {
              headers: {
                "Content-Type": "text/plain",
                "Content-Disposition":
                  "attachment; filename*=UTF-8''Attachment.txt",
              },
            })
    ),
  ]
  if (options?.edit)
    handlers.unshift(
      http.patch(
        "*/api/v1/organizations/:organizationId/projects/:projectId",
        async ({ request, params }) => {
          const input = UpdateProjectSchema.parse(await request.json())
          writes.push(input)
          if (conflict) {
            conflict = false
            revision += 1
            return failure(409, "VERSION_CONFLICT")
          }
          if (input.attachments) {
            if (input.attachments.expectedRevision !== revision)
              return failure(409, "VERSION_CONFLICT")
            items = input.attachments.items.map((ref) =>
              ProjectAttachmentSchema.parse({
                ...projectAttachmentItem,
                ...ref,
              })
            )
            revision += 1
          }
          return HttpResponse.json(
            projectFixtures(String(params.organizationId), "zh-CN")[0]
          )
        }
      )
    )
  return { handlers, writes }
}
