import { describe, expect, it } from "vitest"
import {
  CreateProjectSchema,
  ProjectListQuerySchema,
  ApiErrorSchema,
} from "../../packages/contracts/src/index"

describe("API contracts", () => {
  it("验证分页边界与唯一默认值", () => {
    expect(ProjectListQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 20,
      sortBy: "createdAt",
      sortOrder: "desc",
    })
    for (const input of [
      { page: 0 },
      { page: 1.5 },
      { pageSize: 101 },
      { pageSize: 0 },
      { sortBy: "name" },
      { status: "deleted" },
      { organizationId: "other" },
      { page: [] },
    ]) {
      expect(ProjectListQuerySchema.safeParse(input).success).toBe(false)
    }
    expect(
      ProjectListQuerySchema.parse({ page: "2", name: "  %_  " })
    ).toMatchObject({ page: 2, name: "%_" })
  })
  it("创建不能覆盖租户归属，名称去空白且必须存在", () => {
    expect(
      CreateProjectSchema.parse({ name: "  项目  ", description: null })
    ).toEqual({ name: "项目", description: null })
    for (const input of [
      { name: " ", description: null },
      { name: "项目", description: null, organizationId: "other" },
      { name: "项目", description: null, contentLocale: "fr" },
      { name: "项目", description: null, status: "active" },
    ]) {
      expect(CreateProjectSchema.safeParse(input).success).toBe(false)
    }
  })
  it("错误code与结构固定，文案独立于控制逻辑", () => {
    expect(
      ApiErrorSchema.safeParse({
        code: "FORBIDDEN",
        message: "Access denied",
        requestId: "id",
        locale: "en-US",
      }).success
    ).toBe(true)
    expect(
      ApiErrorSchema.safeParse({
        code: "Access denied",
        message: "Access denied",
        requestId: "id",
        locale: "en-US",
      }).success
    ).toBe(false)
  })
})
