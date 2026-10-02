import { delay, http, HttpResponse } from "msw"
import {
  FileListQuerySchema,
  FilePageSchema,
  FileResponseSchema,
  FolderResponseSchema,
  type FileListQuery,
} from "@workspace/contracts"

const id = (value: number) =>
  `c7dd0a27-4f8a-4aef-8d4c-${String(value).padStart(12, "0")}`
const entryFields = {
  organizationId: id(7100),
  revision: 1,
  state: "active",
  operationId: null,
  deletedAt: null,
  expiresAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
}
export const filePickerRoot = FolderResponseSchema.parse({
  ...entryFields,
  kind: "folder",
  id: id(7101),
  parentId: null,
  name: "Root",
  path: [],
})
export const filePickerFolder = FolderResponseSchema.parse({
  ...entryFields,
  kind: "folder",
  id: id(7102),
  parentId: filePickerRoot.id,
  name: "Manuals",
  path: ["Manuals"],
})
export const filePickerImage = FileResponseSchema.parse({
  ...entryFields,
  kind: "file",
  id: id(7103),
  parentId: filePickerFolder.id,
  name: "portrait.png",
  path: ["Manuals", "portrait.png"],
  currentVersion: {
    id: id(7104),
    fileId: id(7103),
    bytes: 128,
    contentType: "image/png",
    sha256: "a".repeat(64),
    previewKind: "image",
    isCurrent: true,
    createdAt: entryFields.createdAt,
    retiredAt: null,
    expiresAt: null,
  },
})
const reports = Array.from({ length: 23 }, (_, index) =>
  FileResponseSchema.parse({
    ...filePickerImage,
    id: id(7200 + index),
    parentId: filePickerRoot.id,
    name: `Report ${String(index + 1).padStart(2, "0")}.pdf`,
    path: [`Report ${String(index + 1).padStart(2, "0")}.pdf`],
    currentVersion: {
      ...filePickerImage.currentVersion,
      id: id(7300 + index),
      fileId: id(7200 + index),
      bytes: 1024 + index,
      contentType: "application/pdf",
      previewKind: "pdf",
    },
  })
)

export function createFilePickerScenario(
  scenario: "success" | "forbidden" | "slow" = "success"
) {
  const searches: FileListQuery[] = []
  const headers: string[] = []
  let readsAllowed = scenario !== "forbidden"
  const failure = (status: number, code: string) =>
    HttpResponse.json(
      {
        code,
        message: code,
        requestId: "storybook-file-picker",
        locale: "en-US",
      },
      { status }
    )
  async function authorize(organizationId: unknown, request: Request) {
    headers.push(request.headers.get("Accept-Language") ?? "")
    if (scenario === "slow") await delay(300)
    if (organizationId !== filePickerRoot.organizationId || !readsAllowed)
      return failure(403, "FORBIDDEN")
  }
  return {
    searches,
    headers,
    deny: () => {
      readsAllowed = false
    },
    reset: () => {
      searches.length = 0
      headers.length = 0
      readsAllowed = scenario !== "forbidden"
    },
    handlers: [
      http.get(
        "*/api/v1/organizations/:organizationId/files/folders/:folderId/breadcrumbs",
        async ({ params, request }) => {
          const denied = await authorize(params.organizationId, request)
          if (denied) return denied
          if (params.folderId === filePickerRoot.id)
            return HttpResponse.json({ items: [filePickerRoot] })
          if (params.folderId === filePickerFolder.id)
            return HttpResponse.json({
              items: [filePickerRoot, filePickerFolder],
            })
          return failure(404, "NOT_FOUND")
        }
      ),
      http.get(
        "*/api/v1/organizations/:organizationId/files",
        async ({ params, request }) => {
          const denied = await authorize(params.organizationId, request)
          if (denied) return denied
          const query = FileListQuerySchema.parse(
            Object.fromEntries(new URL(request.url).searchParams)
          )
          searches.push(query)
          const all = [filePickerFolder, filePickerImage, ...reports]
          const entries = all
            .filter((entry) =>
              query.name
                ? entry.name.toLowerCase().includes(query.name.toLowerCase())
                : entry.parentId === query.parentId
            )
            .sort((left, right) => {
              const value =
                query.sortBy === "size"
                  ? (left.kind === "file" ? left.currentVersion.bytes : 0) -
                    (right.kind === "file" ? right.currentVersion.bytes : 0)
                  : left[query.sortBy].localeCompare(right[query.sortBy])
              return query.sortOrder === "desc" ? -value : value
            })
          const offset = (query.page - 1) * query.pageSize
          return HttpResponse.json(
            FilePageSchema.parse({
              items: entries.slice(offset, offset + query.pageSize),
              total: entries.length,
              page: query.page,
              pageSize: query.pageSize,
            })
          )
        }
      ),
    ],
  }
}
