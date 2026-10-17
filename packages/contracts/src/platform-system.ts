import { z } from "zod"

export const PlatformSystemStatusSchema = z.enum(["active", "disabled"])
export type PlatformSystemStatus = z.infer<typeof PlatformSystemStatusSchema>
const id = z.uuid()
const text = z.string().trim().min(1).max(200)
const key = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/)
const timestamp = z.iso.datetime({ offset: true })
const sort = z.number().int().min(0).max(2_147_483_647)
const pagination = {
  page: z.coerce.number().int().min(1).max(2_147_483_647).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}
const filters = {
  q: z.string().trim().max(200).optional(),
  status: PlatformSystemStatusSchema.optional(),
}
const page = <T extends z.ZodType>(entity: T) =>
  z.strictObject({
    items: z.array(entity),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
  })

export const PlatformEmployeesQuerySchema = z
  .strictObject({
    ...pagination,
    ...filters,
    departmentId: id.optional(),
    roleId: id.optional(),
    sortBy: z.enum(["name", "status", "createdAt"]).default("createdAt"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
  })
  .meta({ id: "PlatformEmployeesQuery" })
export type PlatformEmployeesQuery = z.infer<
  typeof PlatformEmployeesQuerySchema
>
export const PlatformEmployeeDepartmentSummarySchema = z
  .strictObject({ id, name: z.string() })
  .meta({ id: "PlatformEmployeeDepartmentSummary" })
export const PlatformEmployeePostSummarySchema = z
  .strictObject({ id, name: z.string() })
  .meta({ id: "PlatformEmployeePostSummary" })
export const PlatformEmployeeRoleSummarySchema = z
  .strictObject({ id, key: z.string(), name: z.string(), builtIn: z.boolean() })
  .meta({ id: "PlatformEmployeeRoleSummary" })
export const PlatformEmployeeSchema = z
  .strictObject({
    userId: id,
    name: z.string(),
    maskedEmail: z.string(),
    status: PlatformSystemStatusSchema,
    departmentId: id.nullable(),
    postIds: z.array(id),
    roleIds: z.array(id),
    department: PlatformEmployeeDepartmentSummarySchema.nullable(),
    posts: z.array(PlatformEmployeePostSummarySchema),
    roles: z.array(PlatformEmployeeRoleSummarySchema),
    version: z.number().int().min(1),
    lockedUntil: timestamp.nullable(),
    failedAttempts: z.number().int().min(0),
    createdAt: timestamp,
  })
  .meta({ id: "PlatformEmployee" })
export type PlatformEmployee = z.infer<typeof PlatformEmployeeSchema>
export const PlatformEmployeesPageSchema = page(PlatformEmployeeSchema).meta({
  id: "PlatformEmployeesPage",
})
export type PlatformEmployeesPage = z.infer<typeof PlatformEmployeesPageSchema>
const employeeAssignments = {
  departmentId: id.nullable().optional(),
  postIds: z.array(id).max(100).optional(),
  roleIds: z.array(id).max(100).optional(),
}
export const CreatePlatformEmployeeSchema = z
  .discriminatedUnion("mode", [
    z.strictObject({
      mode: z.literal("create"),
      name: text,
      email: z
        .string()
        .trim()
        .pipe(z.email())
        .transform((value) => value.toLowerCase()),
      password: z.string().min(12).max(128),
      ...employeeAssignments,
    }),
    z.strictObject({
      mode: z.literal("existing"),
      userId: id,
      ...employeeAssignments,
    }),
  ])
  .meta({ id: "CreatePlatformEmployee" })
export type CreatePlatformEmployee = z.infer<
  typeof CreatePlatformEmployeeSchema
>
export const UpdatePlatformEmployeeSchema = z
  .strictObject({
    name: text,
    departmentId: id.nullable(),
    postIds: z.array(id).max(100),
    expectedVersion: z.number().int().min(1),
  })
  .meta({ id: "UpdatePlatformEmployee" })
export type UpdatePlatformEmployee = z.infer<
  typeof UpdatePlatformEmployeeSchema
>
export const SetPlatformEmployeeStatusSchema = z
  .strictObject({
    status: PlatformSystemStatusSchema,
    expectedVersion: z.number().int().min(1),
  })
  .meta({ id: "SetPlatformEmployeeStatus" })
export type SetPlatformEmployeeStatus = z.infer<
  typeof SetPlatformEmployeeStatusSchema
>
export const SetPlatformEmployeeRolesSchema = z
  .strictObject({
    roleIds: z.array(id).max(100),
    expectedVersion: z.number().int().min(1),
  })
  .meta({ id: "SetPlatformEmployeeRoles" })
export type SetPlatformEmployeeRoles = z.infer<
  typeof SetPlatformEmployeeRolesSchema
>
export const BatchRemovePlatformEmployeesSchema = z
  .strictObject({
    userIds: z.array(id).min(1).max(100),
  })
  .meta({ id: "BatchRemovePlatformEmployees" })
export type BatchRemovePlatformEmployees = z.infer<
  typeof BatchRemovePlatformEmployeesSchema
>
export const PlatformSystemDeleteResultSchema = z
  .strictObject({ id, deleted: z.literal(true) })
  .meta({ id: "PlatformSystemDeleteResult" })
export const PlatformEmployeeBatchRemoveResultSchema = z
  .strictObject({ userIds: z.array(id), deleted: z.literal(true) })
  .meta({ id: "PlatformEmployeeBatchRemoveResult" })
export const PlatformSystemRefreshResultSchema = z
  .strictObject({
    refreshed: z.literal(true),
    version: z.number().int().min(1),
  })
  .meta({ id: "PlatformSystemRefreshResult" })
export const SetPlatformSystemStatusSchema = z
  .strictObject({ status: PlatformSystemStatusSchema })
  .meta({ id: "SetPlatformSystemStatus" })
export type SetPlatformSystemStatus = z.infer<
  typeof SetPlatformSystemStatusSchema
>

export const PlatformSystemQuerySchema = z
  .strictObject({
    ...pagination,
    ...filters,
    sortBy: z.enum(["sort", "key", "name", "createdAt"]).default("sort"),
    sortOrder: z.enum(["asc", "desc"]).default("asc"),
  })
  .meta({ id: "PlatformSystemQuery" })
export type PlatformSystemQuery = z.infer<typeof PlatformSystemQuerySchema>
const catalog = {
  id,
  key,
  name: z.string(),
  status: PlatformSystemStatusSchema,
  sort,
  createdAt: timestamp,
  updatedAt: timestamp,
}
const catalogInput = {
  key,
  name: text,
  status: PlatformSystemStatusSchema,
  sort,
}
export const PlatformRoleSchema = z
  .strictObject({
    ...catalog,
    builtIn: z.boolean(),
    permissions: z.array(z.string()),
  })
  .meta({ id: "PlatformRole" })
export type PlatformRole = z.infer<typeof PlatformRoleSchema>
export const PlatformRolesPageSchema = page(PlatformRoleSchema).meta({
  id: "PlatformRolesPage",
})
export const CreatePlatformRoleSchema = z
  .strictObject(catalogInput)
  .meta({ id: "CreatePlatformRole" })
export type CreatePlatformRole = z.infer<typeof CreatePlatformRoleSchema>
export const UpdatePlatformRoleSchema = z
  .strictObject(catalogInput)
  .meta({ id: "UpdatePlatformRole" })
export type UpdatePlatformRole = z.infer<typeof UpdatePlatformRoleSchema>
export const SetPlatformRolePermissionsSchema = z
  .strictObject({
    permissions: z.array(z.string().trim().min(1).max(120)).max(500),
  })
  .meta({ id: "SetPlatformRolePermissions" })
export type SetPlatformRolePermissions = z.infer<
  typeof SetPlatformRolePermissionsSchema
>
export const PlatformRoleEmployeesQuerySchema =
  PlatformEmployeesQuerySchema.omit({ roleId: true })
    .extend({
      assigned: z
        .enum(["true", "false"])
        .transform((value) => value === "true"),
    })
    .meta({ id: "PlatformRoleEmployeesQuery" })
export type PlatformRoleEmployeesQuery = z.infer<
  typeof PlatformRoleEmployeesQuerySchema
>
export const SetPlatformRoleEmployeesSchema = z
  .strictObject({ userIds: z.array(id).min(1).max(100) })
  .meta({ id: "SetPlatformRoleEmployees" })
export type SetPlatformRoleEmployees = z.infer<
  typeof SetPlatformRoleEmployeesSchema
>
export const PlatformRoleEmployeesMutationResultSchema = z
  .strictObject({ roleId: id, userIds: z.array(id), assigned: z.boolean() })
  .meta({ id: "PlatformRoleEmployeesMutationResult" })

export const PlatformSystemTreeQuerySchema = z
  .strictObject({ ...filters, parentId: id.optional() })
  .meta({ id: "PlatformSystemTreeQuery" })
export type PlatformSystemTreeQuery = z.infer<
  typeof PlatformSystemTreeQuerySchema
>
export const PlatformMenuKindSchema = z.enum([
  "directory",
  "page",
  "action",
  "external",
  "iframe",
])
export const PlatformMenuSchema = z
  .strictObject({
    ...catalog,
    parentId: id.nullable(),
    kind: PlatformMenuKindSchema,
    routeKey: z.string().nullable(),
    actionKey: z.string().nullable(),
    url: z.string().nullable(),
    icon: z.string().nullable(),
    hidden: z.boolean(),
    hasChildren: z.boolean(),
  })
  .meta({ id: "PlatformMenu" })
export type PlatformMenu = z.infer<typeof PlatformMenuSchema>
const menuInput = {
  ...catalogInput,
  parentId: id.nullable(),
  kind: PlatformMenuKindSchema,
  routeKey: z.string().trim().min(1).max(200).nullable(),
  actionKey: z.string().trim().min(1).max(120).nullable(),
  url: z.url().max(2000).nullable(),
  icon: z.string().trim().min(1).max(100).nullable(),
  hidden: z.boolean(),
}
export const CreatePlatformMenuSchema = z
  .strictObject(menuInput)
  .meta({ id: "CreatePlatformMenu" })
export type CreatePlatformMenu = z.infer<typeof CreatePlatformMenuSchema>
export const UpdatePlatformMenuSchema = z
  .strictObject(menuInput)
  .meta({ id: "UpdatePlatformMenu" })
export type UpdatePlatformMenu = z.infer<typeof UpdatePlatformMenuSchema>
export const PlatformMenusTreeSchema = z
  .strictObject({
    items: z.array(PlatformMenuSchema),
    ancestors: z.array(PlatformMenuSchema),
  })
  .meta({ id: "PlatformMenusTree" })
export const PlatformDepartmentSchema = z
  .strictObject({
    ...catalog,
    parentId: id.nullable(),
    hasChildren: z.boolean(),
  })
  .meta({ id: "PlatformDepartment" })
export type PlatformDepartment = z.infer<typeof PlatformDepartmentSchema>
export const CreatePlatformDepartmentSchema = z
  .strictObject({ ...catalogInput, parentId: id.nullable() })
  .meta({ id: "CreatePlatformDepartment" })
export type CreatePlatformDepartment = z.infer<
  typeof CreatePlatformDepartmentSchema
>
export const UpdatePlatformDepartmentSchema = z
  .strictObject({ ...catalogInput, parentId: id.nullable() })
  .meta({ id: "UpdatePlatformDepartment" })
export type UpdatePlatformDepartment = z.infer<
  typeof UpdatePlatformDepartmentSchema
>
export const PlatformDepartmentsTreeSchema = z
  .strictObject({
    items: z.array(PlatformDepartmentSchema),
    ancestors: z.array(PlatformDepartmentSchema),
  })
  .meta({ id: "PlatformDepartmentsTree" })
export const PlatformPostSchema = z
  .strictObject(catalog)
  .meta({ id: "PlatformPost" })
export type PlatformPost = z.infer<typeof PlatformPostSchema>
export const PlatformPostsPageSchema = page(PlatformPostSchema).meta({
  id: "PlatformPostsPage",
})
export const CreatePlatformPostSchema = z
  .strictObject(catalogInput)
  .meta({ id: "CreatePlatformPost" })
export type CreatePlatformPost = z.infer<typeof CreatePlatformPostSchema>
export const UpdatePlatformPostSchema = z
  .strictObject(catalogInput)
  .meta({ id: "UpdatePlatformPost" })
export type UpdatePlatformPost = z.infer<typeof UpdatePlatformPostSchema>
export const PlatformDictionarySchema = z
  .strictObject({ ...catalog, remark: z.string().nullable() })
  .meta({ id: "PlatformDictionary" })
export type PlatformDictionary = z.infer<typeof PlatformDictionarySchema>
const dictionaryInput = {
  ...catalogInput,
  remark: z.string().trim().max(1000).nullable(),
}
export const CreatePlatformDictionarySchema = z
  .strictObject(dictionaryInput)
  .meta({ id: "CreatePlatformDictionary" })
export type CreatePlatformDictionary = z.infer<
  typeof CreatePlatformDictionarySchema
>
export const UpdatePlatformDictionarySchema = z
  .strictObject(dictionaryInput)
  .meta({ id: "UpdatePlatformDictionary" })
export type UpdatePlatformDictionary = z.infer<
  typeof UpdatePlatformDictionarySchema
>
export const PlatformDictionariesPageSchema = page(
  PlatformDictionarySchema
).meta({ id: "PlatformDictionariesPage" })
export const PlatformDictionaryItemsQuerySchema = z
  .strictObject({
    ...pagination,
    ...filters,
    sortBy: z.enum(["sort", "value", "label", "createdAt"]).default("sort"),
    sortOrder: z.enum(["asc", "desc"]).default("asc"),
  })
  .meta({ id: "PlatformDictionaryItemsQuery" })
export type PlatformDictionaryItemsQuery = z.infer<
  typeof PlatformDictionaryItemsQuerySchema
>
export const PlatformDictionaryItemSchema = z
  .strictObject({
    id,
    dictionaryId: id,
    value: z.string(),
    label: z.string(),
    status: PlatformSystemStatusSchema,
    sort,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .meta({ id: "PlatformDictionaryItem" })
export type PlatformDictionaryItem = z.infer<
  typeof PlatformDictionaryItemSchema
>
const dictionaryItemInput = {
  value: z.string().trim().min(1).max(500),
  label: text,
  status: PlatformSystemStatusSchema,
  sort,
}
export const CreatePlatformDictionaryItemSchema = z
  .strictObject(dictionaryItemInput)
  .meta({ id: "CreatePlatformDictionaryItem" })
export type CreatePlatformDictionaryItem = z.infer<
  typeof CreatePlatformDictionaryItemSchema
>
export const UpdatePlatformDictionaryItemSchema = z
  .strictObject(dictionaryItemInput)
  .meta({ id: "UpdatePlatformDictionaryItem" })
export type UpdatePlatformDictionaryItem = z.infer<
  typeof UpdatePlatformDictionaryItemSchema
>
export const PlatformDictionaryItemsPageSchema = page(
  PlatformDictionaryItemSchema
).meta({ id: "PlatformDictionaryItemsPage" })
export const PlatformDictionaryValueSchema = PlatformDictionarySchema.extend({
  items: z.array(PlatformDictionaryItemSchema),
  version: z.number().int().min(1),
}).meta({ id: "PlatformDictionaryValue" })
export const PlatformParameterSchema = z
  .strictObject({
    ...catalog,
    value: z.string(),
    remark: z.string().nullable(),
  })
  .meta({ id: "PlatformParameter" })
export type PlatformParameter = z.infer<typeof PlatformParameterSchema>
const parameterInput = {
  ...catalogInput,
  value: z.string().max(10_000),
  remark: z.string().trim().max(1000).nullable(),
}
export const CreatePlatformParameterSchema = z
  .strictObject(parameterInput)
  .meta({ id: "CreatePlatformParameter" })
export type CreatePlatformParameter = z.infer<
  typeof CreatePlatformParameterSchema
>
export const UpdatePlatformParameterSchema = z
  .strictObject(parameterInput)
  .meta({ id: "UpdatePlatformParameter" })
export type UpdatePlatformParameter = z.infer<
  typeof UpdatePlatformParameterSchema
>
export const PlatformParametersPageSchema = page(PlatformParameterSchema).meta({
  id: "PlatformParametersPage",
})
export const PlatformParameterValueSchema = PlatformParameterSchema.extend({
  version: z.number().int().min(1),
}).meta({ id: "PlatformParameterValue" })
export const PlatformSystemKeySchema = key

export const PlatformEmployeeCandidatesQuerySchema = z
  .strictObject({ ...pagination, q: z.string().trim().max(200).optional() })
  .meta({ id: "PlatformEmployeeCandidatesQuery" })
export type PlatformEmployeeCandidatesQuery = z.infer<
  typeof PlatformEmployeeCandidatesQuerySchema
>
export const PlatformEmployeeCandidatesPageSchema = page(
  PlatformEmployeeSchema.pick({ userId: true, name: true, maskedEmail: true })
).meta({ id: "PlatformEmployeeCandidatesPage" })
export const PlatformEmployeeOptionsQuerySchema = z
  .strictObject({
    ...pagination,
    q: z.string().trim().max(200).optional(),
    status: PlatformSystemStatusSchema.optional(),
    ids: z
      .string()
      .min(1)
      .max(3699)
      .refine((value) => {
        const values = value.split(",")
        return (
          values.length <= 100 &&
          values.every((value) => id.safeParse(value).success)
        )
      })
      .optional(),
  })
  .meta({ id: "PlatformEmployeeOptionsQuery" })
export type PlatformEmployeeOptionsQuery = z.infer<
  typeof PlatformEmployeeOptionsQuerySchema
>
const employeeOption = {
  id,
  key: z.string(),
  name: z.string(),
  status: PlatformSystemStatusSchema,
}
export const PlatformEmployeeDepartmentOptionSchema = z
  .strictObject({
    ...employeeOption,
    parentId: id.nullable(),
    hasChildren: z.boolean(),
  })
  .meta({ id: "PlatformEmployeeDepartmentOption" })
export const PlatformEmployeePostOptionSchema = z
  .strictObject(employeeOption)
  .meta({ id: "PlatformEmployeePostOption" })
export const PlatformEmployeeRoleOptionSchema = z
  .strictObject(employeeOption)
  .meta({ id: "PlatformEmployeeRoleOption" })
export const PlatformEmployeeDepartmentOptionsPageSchema = page(
  PlatformEmployeeDepartmentOptionSchema
).meta({ id: "PlatformEmployeeDepartmentOptionsPage" })
export const PlatformEmployeePostOptionsPageSchema = page(
  PlatformEmployeePostOptionSchema
).meta({ id: "PlatformEmployeePostOptionsPage" })
export const PlatformEmployeeRoleOptionsPageSchema = page(
  PlatformEmployeeRoleOptionSchema
).meta({ id: "PlatformEmployeeRoleOptionsPage" })
export const PlatformMenuRegistrySchema = z
  .strictObject({
    pages: z.array(z.strictObject({ key: z.string(), path: z.string() })),
    actions: z.array(z.strictObject({ key: z.string() })),
  })
  .meta({ id: "PlatformMenuRegistry" })
export type PlatformNavigationItem = {
  id: string
  name: string
  kind: z.infer<typeof PlatformMenuKindSchema>
  routeKey: string | null
  url: string | null
  icon: string | null
  hidden: boolean
  children: PlatformNavigationItem[]
}
export const PlatformNavigationItemSchema: z.ZodType<PlatformNavigationItem> = z
  .lazy(() =>
    z.strictObject({
      id,
      name: z.string(),
      kind: PlatformMenuKindSchema,
      routeKey: z.string().nullable(),
      url: z.string().nullable(),
      icon: z.string().nullable(),
      hidden: z.boolean(),
      children: z.array(PlatformNavigationItemSchema),
    })
  )
  .meta({ id: "PlatformNavigationItem" })
export const PlatformNavigationSchema = z
  .strictObject({ items: z.array(PlatformNavigationItemSchema) })
  .meta({ id: "PlatformNavigation" })

export type PlatformMenuKind = z.infer<typeof PlatformMenuKindSchema>
export type PlatformRolesPage = z.infer<typeof PlatformRolesPageSchema>
export type PlatformPostsPage = z.infer<typeof PlatformPostsPageSchema>
export type PlatformDictionariesPage = z.infer<
  typeof PlatformDictionariesPageSchema
>
export type PlatformDictionaryItemsPage = z.infer<
  typeof PlatformDictionaryItemsPageSchema
>
export type PlatformParametersPage = z.infer<
  typeof PlatformParametersPageSchema
>
export type PlatformMenusTree = z.infer<typeof PlatformMenusTreeSchema>
export type PlatformDepartmentsTree = z.infer<
  typeof PlatformDepartmentsTreeSchema
>
export type PlatformSystemDeleteResult = z.infer<
  typeof PlatformSystemDeleteResultSchema
>
export type PlatformEmployeeBatchRemoveResult = z.infer<
  typeof PlatformEmployeeBatchRemoveResultSchema
>
export type PlatformSystemRefreshResult = z.infer<
  typeof PlatformSystemRefreshResultSchema
>
export type PlatformRoleEmployeesMutationResult = z.infer<
  typeof PlatformRoleEmployeesMutationResultSchema
>
export type PlatformDictionaryValue = z.infer<
  typeof PlatformDictionaryValueSchema
>
export type PlatformParameterValue = z.infer<
  typeof PlatformParameterValueSchema
>
export type PlatformEmployeeCandidatesPage = z.infer<
  typeof PlatformEmployeeCandidatesPageSchema
>
export type PlatformMenuRegistry = z.infer<typeof PlatformMenuRegistrySchema>
export type PlatformNavigation = z.infer<typeof PlatformNavigationSchema>

export type PlatformEmployeeDepartmentSummary = z.infer<
  typeof PlatformEmployeeDepartmentSummarySchema
>
export type PlatformEmployeePostSummary = z.infer<
  typeof PlatformEmployeePostSummarySchema
>
export type PlatformEmployeeRoleSummary = z.infer<
  typeof PlatformEmployeeRoleSummarySchema
>
export type PlatformEmployeeDepartmentOption = z.infer<
  typeof PlatformEmployeeDepartmentOptionSchema
>
export type PlatformEmployeePostOption = z.infer<
  typeof PlatformEmployeePostOptionSchema
>
export type PlatformEmployeeDepartmentOptionsPage = z.infer<
  typeof PlatformEmployeeDepartmentOptionsPageSchema
>
export type PlatformEmployeePostOptionsPage = z.infer<
  typeof PlatformEmployeePostOptionsPageSchema
>

export type PlatformEmployeeRoleOption = z.infer<
  typeof PlatformEmployeeRoleOptionSchema
>
export type PlatformEmployeeRoleOptionsPage = z.infer<
  typeof PlatformEmployeeRoleOptionsPageSchema
>
