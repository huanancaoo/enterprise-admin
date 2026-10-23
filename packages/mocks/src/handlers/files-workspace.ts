import { delay, http, HttpResponse } from "msw"
import {
  FileListQuerySchema,
  FileResponseSchema,
  FolderResponseSchema,
  maxOrganizationUploadBytes,
  type FileEntryResponse,
  type FileListQuery,
} from "@workspace/contracts"
import { filePickerImage, filePickerRoot } from "./file-picker"

const id = (value: number) =>
  `d7dd0a27-4f8a-4aef-8d4c-${String(value).padStart(12, "0")}`
const organizationId = filePickerRoot.organizationId
const root = { ...filePickerRoot, name: "全部文件" }
function folder(value: number, name: string, parent = root) {
  return FolderResponseSchema.parse({
    ...root,
    id: id(value),
    name,
    parentId: parent.id,
    path: [...parent.path, name],
  })
}
const marketing = folder(1, "市场资料")
const launch = folder(2, "2026 秋季发布", marketing)
const folders = [
  marketing,
  launch,
  folder(3, "品牌资产", marketing),
  folder(4, "历史活动", marketing),
  folder(5, "产品设计"),
  folder(6, "项目文档"),
  folder(7, "团队共享"),
  folder(8, "归档"),
]
const poster = FileResponseSchema.parse({
  ...filePickerImage,
  id: id(20),
  parentId: launch.id,
  name: "秋季发布主视觉.png",
  path: [...launch.path, "秋季发布主视觉.png"],
  updatedAt: "2026-10-15T09:41:00.000Z",
  currentVersion: {
    ...filePickerImage.currentVersion,
    id: id(120),
    fileId: id(20),
    bytes: 2516582,
  },
})
const contentFiles = [
  poster,
  ...[
    "发布会流程.pdf",
    "社交媒体文案.docx",
    "品牌规范.pdf",
    "渠道投放计划.xlsx",
    "产品介绍.pdf",
    "发布会演示.pptx",
    "素材清单.xlsx",
  ].map((name, index) =>
    FileResponseSchema.parse({
      ...poster,
      id: id(30 + index),
      name,
      path: [...launch.path, name],
      currentVersion: {
        ...poster.currentVersion,
        id: id(130 + index),
        fileId: id(30 + index),
        contentType: name.endsWith("pdf")
          ? "application/pdf"
          : "application/octet-stream",
        previewKind: name.endsWith("pdf") ? "pdf" : "none",
        bytes: 235000 + index * 132000,
      },
    })
  ),
]
const launchFolders = [
  folder(9, "主视觉素材", launch),
  folder(10, "渠道物料", launch),
]
// 根目录混合列表跨两页，目录树必须读完分页才能展示后面的文件夹。
const rootFiles = Array.from({ length: 101 }, (_, index) =>
  FileResponseSchema.parse({
    ...contentFiles[1],
    id: id(1000 + index),
    name: `A${index}.pdf`,
    parentId: root.id,
    path: [`A${index}.pdf`],
    currentVersion: {
      ...contentFiles[1]!.currentVersion,
      id: id(2000 + index),
      fileId: id(1000 + index),
    },
  })
)
const entries: FileEntryResponse[] = [
  root,
  ...folders,
  ...launchFolders,
  ...contentFiles,
  ...rootFiles,
]
const queries: FileListQuery[] = []

function listEntries(request: Request) {
  const query = FileListQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams)
  )
  queries.push(query)
  const results = entries
    .filter(
      (entry) =>
        entry.parentId !== null &&
        query.state === "active" &&
        (query.name
          ? entry.name.includes(query.name)
          : entry.parentId === query.parentId)
    )
    .sort((left, right) => {
      const order =
        query.sortBy === "size"
          ? (left.kind === "file" ? left.currentVersion.bytes : 0) -
            (right.kind === "file" ? right.currentVersion.bytes : 0)
          : left[query.sortBy].localeCompare(right[query.sortBy], "en-US")
      return query.sortOrder === "desc" ? -order : order
    })
  return HttpResponse.json({
    items: results.slice(
      (query.page - 1) * query.pageSize,
      query.page * query.pageSize
    ),
    total: results.length,
    page: query.page,
    pageSize: query.pageSize,
  })
}

const handlers = [
  http.get("*/api/v1/organizations/:organizationId/access", () =>
    HttpResponse.json({
      organizationId,
      status: "ACTIVE",
      authorizationVersion: 1,
      effectiveLocale: "zh-CN",
      effectiveLocaleSource: "organization",
    })
  ),
  http.post("*/api/auth/organization/has-permission", () =>
    HttpResponse.json({ success: true, error: null })
  ),
  http.get("*/api/v1/organizations/:organizationId/files/workspace", () =>
    HttpResponse.json({
      root,
      usage: {
        quotaBytes: 10737418240,
        usedBytes: 2748779069,
        reservedBytes: 0,
        transientBytes: 0,
        trashDays: 30,
        historyDays: 30,
        policyRevision: 1,
        maxUploadBytes: maxOrganizationUploadBytes,
      },
    })
  ),
  http.get(
    "*/api/v1/organizations/:organizationId/files/folders/:folderId/breadcrumbs",
    ({ params }) => {
      const path = []
      let current = entries.find((entry) => entry.id === params.folderId)
      while (current) {
        path.unshift(current)
        current = entries.find((entry) => entry.id === current?.parentId)
      }
      return HttpResponse.json({ items: path })
    }
  ),
  http.get("*/api/v1/organizations/:organizationId/files", ({ request }) =>
    listEntries(request)
  ),
  http.get(
    "*/api/v1/organizations/:organizationId/files/entries/:entryId",
    ({ params }) =>
      HttpResponse.json(entries.find((entry) => entry.id === params.entryId))
  ),
  http.get(
    "*/api/v1/organizations/:organizationId/files/entries/:entryId/versions/:versionId/content",
    async () => {
      const response = await fetch("/file-explorer-autumn.png")
      return new HttpResponse(await response.arrayBuffer(), {
        headers: { "Content-Type": "image/png" },
      })
    }
  ),
]

export const fileWorkspaceScenario = {
  organizationId,
  root,
  launch,
  brand: folders[2]!,
  poster,
  queries,
  handlers,
  slowNavigationHandlers: [
    http.get(
      `*/api/v1/organizations/:organizationId/files/folders/${launch.id}/breadcrumbs`,
      async () => {
        await delay(500)
        return HttpResponse.json({ items: [root, marketing, launch] })
      }
    ),
    http.get(
      "*/api/v1/organizations/:organizationId/files",
      async ({ request }) => {
        if (
          new URL(request.url).searchParams.get("parentId") === folders[2]!.id
        ) {
          await delay(500)
        }
        return listEntries(request)
      }
    ),
    http.get(
      `*/api/v1/organizations/:organizationId/files/folders/${folders[2]!.id}/breadcrumbs`,
      async () => {
        await delay(500)
        return HttpResponse.json({ items: [root, marketing, folders[2]!] })
      }
    ),
    ...handlers,
  ],
  readOnlyHandlers: [
    http.post("*/api/auth/organization/has-permission", async ({ request }) => {
      const body = (await request.json()) as {
        permissions: Record<string, string[]>
      }
      return HttpResponse.json({
        success: Object.values(body.permissions)
          .flat()
          .every((action) => action === "read"),
        error: null,
      })
    }),
    ...handlers,
  ],
}
