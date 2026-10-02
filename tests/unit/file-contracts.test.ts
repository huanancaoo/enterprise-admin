import { describe, expect, it } from "vitest"
import {
  CreateFolderSchema,
  FileContentQuerySchema,
  FileErrorDetailsSchema,
  FileListQuerySchema,
  FileOperationResponseSchema,
  FileResponseSchema,
  FolderResponseSchema,
  UploadFileFieldsSchema,
  maxOrganizationUploadBytes,
} from "../../packages/contracts/src/files.js"

const entryId = "8a5a8b2b-0668-4f2a-baa3-e6f793de4f32"
const organizationId = "e2d295d1-757d-472f-a0de-0a58caa8c5db"
const versionId = "c531e8a7-335a-470a-8845-e3a5b335939f"
const operationId = "aa4fce04-11b1-48e1-bb36-a7e73cc81c61"
const now = "2026-10-02T00:00:00.000Z"
const entry = {
  id: entryId,
  organizationId,
  parentId: null,
  name: "",
  path: [],
  revision: 1,
  state: "active",
  operationId: null,
  deletedAt: null,
  expiresAt: null,
  createdAt: now,
  updatedAt: now,
}
const operation = {
  id: operationId,
  action: "upload",
  phase: "preparing",
  committedAt: null,
  completedAt: null,
  errorCode: null,
  result: null,
  createdAt: now,
  updatedAt: now,
}

describe("Files HTTP contracts", () => {
  it("normalizes names using the real folder byte limit", () => {
    const input = { operationId, parentId: entryId, name: "  cafe\u0301  " }
    expect(CreateFolderSchema.parse(input).name).toBe("café")
    expect(
      CreateFolderSchema.safeParse({ ...input, name: "中".repeat(82) }).success
    ).toBe(true)
    expect(
      CreateFolderSchema.safeParse({ ...input, name: "a".repeat(247) }).success
    ).toBe(false)
  })

  it("accepts a 255-byte file and zero bytes but rejects oversized declarations", () => {
    const input = {
      operationId,
      parentId: entryId,
      name: "a".repeat(255),
      contentSha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      declaredBytes: "0",
    }
    expect(UploadFileFieldsSchema.parse(input).declaredBytes).toBe(0)
    expect(
      UploadFileFieldsSchema.safeParse({
        ...input,
        declaredBytes: maxOrganizationUploadBytes + 1,
      }).success
    ).toBe(false)
  })

  it("rejects client ownership and physical storage controls", () => {
    const input = { operationId, parentId: entryId, name: "合同" }
    for (const extra of [
      { organizationId },
      { userId: entryId },
      { backend: "s3" },
      { bucket: "private" },
      { objectKey: "organizations/elsewhere/file" },
    ]) {
      expect(CreateFolderSchema.safeParse({ ...input, ...extra }).success).toBe(
        false
      )
    }
  })

  it("validates server pagination while keeping active and trash searches distinct", () => {
    expect(FileListQuerySchema.parse({})).toEqual({
      state: "active",
      page: 1,
      pageSize: 20,
      sortBy: "name",
      sortOrder: "asc",
    })
    expect(
      FileListQuerySchema.parse({ state: "trashed", name: " 合同 ", page: "2" })
    ).toMatchObject({ state: "trashed", name: "合同", page: 2 })
    expect(FileListQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false)
  })

  it("exports query objects inline so Swagger can expand each parameter", () => {
    // Nest Swagger 只展开内联对象；查询根级 $ref 会悄悄丢失生成客户端的参数。
    const list = FileListQuerySchema["~standard"].jsonSchema.input({
      target: "openapi-3.0",
    })
    expect(list.type).toBe("object")
    expect(list).not.toHaveProperty("$ref")
    expect(Object.keys(list.properties ?? {})).toEqual([
      "parentId",
      "state",
      "name",
      "page",
      "pageSize",
      "sortBy",
      "sortOrder",
    ])
    const content = FileContentQuerySchema["~standard"].jsonSchema.input({
      target: "openapi-3.0",
    })
    expect(content.type).toBe("object")
    expect(content.properties).toHaveProperty("disposition")
  })

  it("does not represent folder markers as downloadable files", () => {
    expect(
      FolderResponseSchema.safeParse({ kind: "folder", ...entry }).success
    ).toBe(true)
    expect(
      FolderResponseSchema.safeParse({ kind: "folder", ...entry, bytes: 0 })
        .success
    ).toBe(false)
    expect(
      FileResponseSchema.safeParse({ kind: "file", ...entry }).success
    ).toBe(false)
  })

  it("keeps file version identity and content facts without a public URL", () => {
    const file = {
      kind: "file",
      ...entry,
      parentId: entryId,
      name: "empty.txt",
      path: ["empty.txt"],
      currentVersion: {
        id: versionId,
        fileId: entryId,
        bytes: 0,
        contentType: "text/plain",
        sha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        previewKind: "text",
        isCurrent: true,
        createdAt: now,
        retiredAt: null,
        expiresAt: null,
      },
    }
    expect(FileResponseSchema.safeParse(file).success).toBe(true)
    expect(
      FileResponseSchema.safeParse({ ...file, url: "https://bucket/file" })
        .success
    ).toBe(false)
  })

  it("distinguishes committed cleanup failure from pre-publication failure", () => {
    expect(
      FileOperationResponseSchema.safeParse({
        ...operation,
        phase: "failed",
        errorCode: "FILE_STORAGE_UNAVAILABLE",
      }).success
    ).toBe(true)
    expect(
      FileOperationResponseSchema.safeParse({
        ...operation,
        phase: "cleaning",
        committedAt: now,
        errorCode: "FILE_STORAGE_UNAVAILABLE",
        result: { entryId, versionId, revision: 1 },
      }).success
    ).toBe(true)
    expect(
      FileOperationResponseSchema.safeParse({
        ...operation,
        phase: "completed",
      }).success
    ).toBe(false)
    expect(
      FileOperationResponseSchema.safeParse({
        ...operation,
        phase: "failed",
        committedAt: now,
        result: { entryId, revision: 1 },
      }).success
    ).toBe(false)
  })

  it("exposes only safe error facts", () => {
    expect(
      FileErrorDetailsSchema.safeParse({ operationId, referenceCount: 2 })
        .success
    ).toBe(true)
    expect(
      FileErrorDetailsSchema.safeParse({ operationId, path: "/private/root" })
        .success
    ).toBe(false)
  })

  it("exports multipart fields to OpenAPI without storage controls", () => {
    const document = UploadFileFieldsSchema.toJSONSchema({ io: "input" })
    const schema = document.$defs?.UploadFileFields
    expect(document.$ref).toBe("#/$defs/UploadFileFields")
    expect(schema).toBeDefined()
    expect(schema?.properties).toHaveProperty("declaredBytes")
    expect(schema?.required).toContain("operationId")
    expect(schema?.required).toContain("parentId")
    expect(schema?.required).toContain("contentSha256")
    expect(schema?.properties).not.toHaveProperty("bucket")
    expect(schema?.additionalProperties).toBe(false)
  })
})
