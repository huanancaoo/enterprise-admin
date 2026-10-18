import { locales } from "./config.mjs"

export function names(config) {
  return {
    ...config,
    Entity: config.entity[0].toUpperCase() + config.entity.slice(1),
    Domain: config.domain[0].toUpperCase() + config.domain.slice(1),
  }
}
export function catalogs(config) {
  const wording = {
    "zh-CN": {
      create: "新增",
      createDescription: "填写名称并保存。",
      remove: "删除",
      removeDescription: "此操作不可撤销，历史操作日志仍会保留。",
      createdAt: "创建时间",
      actions: "操作",
      search: "按名称搜索",
      nameInvalid: "请填写符合长度要求的名称。",
      permissionRead: "查看",
      permissionCreate: "新增",
      permissionDelete: "删除",
    },
    "en-US": {
      create: "Create",
      createDescription: "Enter a name and save.",
      remove: "Delete",
      removeDescription:
        "This action cannot be undone. Operation logs are retained.",
      createdAt: "Created at",
      actions: "Actions",
      search: "Search by name",
      nameInvalid: "Enter a name within the allowed length.",
      permissionRead: "Read",
      permissionCreate: "Create",
      permissionDelete: "Delete",
    },
    ar: {
      create: "إضافة",
      createDescription: "أدخل الاسم ثم احفظ.",
      remove: "حذف",
      removeDescription:
        "لا يمكن التراجع عن هذا الإجراء. تبقى سجلات العمليات محفوظة.",
      createdAt: "تاريخ الإنشاء",
      actions: "الإجراءات",
      search: "البحث بالاسم",
      nameInvalid: "أدخل اسماً ضمن الطول المسموح.",
      permissionRead: "عرض",
      permissionCreate: "إضافة",
      permissionDelete: "حذف",
    },
  }
  return Object.fromEntries(
    locales.map((locale) => [
      locale,
      { ...config.labels[locale], ...wording[locale] },
    ])
  )
}
export function sortCatalog(catalog) {
  return Object.fromEntries(
    Object.entries(catalog).sort(
      ([a], [b]) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }) ||
        a.localeCompare(b, undefined, { sensitivity: "case" })
    )
  )
}

export function templates(input) {
  const {
    entity: e,
    domain: d,
    table,
    Entity: E,
    Domain: D,
    name,
  } = names(input)
  const minimum = name.minLength,
    maximum = name.maxLength
  const files = new Map()
  files.set(
    `packages/database/src/schema/${d}.ts`,
    `import { sql } from "drizzle-orm"
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { organization } from "./auth.ts"

export const ${d} = pgTable("${table}", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organization.id),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (columns) => [
  check("${table}_name_length", sql\`char_length(btrim(\$\{columns.name\})) BETWEEN ${minimum} AND ${maximum}\`),
  index("${table}_organization_created_idx").on(columns.organizationId, columns.createdAt, columns.id),
])
`
  )
  files.set(
    `packages/database/src/repositories/${d}.ts`,
    `import { and, asc, count, desc, eq, ilike } from "drizzle-orm"
import { ${d} } from "../schema/${d}.ts"
import type { TenantTx } from "../tenant.ts"

type ListQuery = { page: number; pageSize: number; name?: string; sortBy: "name" | "createdAt"; sortOrder: "asc" | "desc" }
export const ${e}Repository = {
  async list(tx: TenantTx, query: ListQuery) {
    const filter = and(eq(${d}.organizationId, tx.context.organizationId), query.name ? ilike(${d}.name, "%" + query.name.replace(/[\\\\%_]/g, "\\\\$&") + "%") : undefined)
    const direction = query.sortOrder === "asc" ? asc : desc
    const items = await tx.select().from(${d}).where(filter).orderBy(direction(${d}[query.sortBy]), direction(${d}.id)).limit(query.pageSize).offset((query.page - 1) * query.pageSize)
    const [total] = await tx.select({ value: count() }).from(${d}).where(filter)
    return { items, total: total!.value, page: query.page, pageSize: query.pageSize }
  },
  async create(tx: TenantTx, input: { name: string }) {
    // 组织归属只取可信事务，输入不能选择资源所属组织。
    const [item] = await tx.insert(${d}).values({ ...input, organizationId: tx.context.organizationId }).returning()
    return item!
  },
  async remove(tx: TenantTx, id: string) {
    const [item] = await tx.delete(${d}).where(and(eq(${d}.organizationId, tx.context.organizationId), eq(${d}.id, id))).returning()
    return item
  },
}
`
  )
  files.set(
    `packages/contracts/src/${d}.ts`,
    `import { z } from "zod"
import { OrganizationIdSchema } from "./identifiers.js"

export const ${E}IdSchema = z.uuid().meta({ id: "${E}Id" })
export function create${E}NameSchema(message = "Name length must be between ${minimum} and ${maximum} Unicode characters") {
  return z.string().trim().refine((value) => { const length = [...value].length; return length >= ${minimum} && length <= ${maximum} }, message).meta({ id: "${E}Name", minLength: ${minimum}, maxLength: ${maximum} })
}
export const Create${E}Schema = z.strictObject({ name: create${E}NameSchema() }).meta({ id: "Create${E}" })
export type Create${E} = z.infer<typeof Create${E}Schema>
export const ${E}ListQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  name: z.string().trim().refine((value) => [...value].length <= ${maximum}).optional(),
  sortBy: z.enum(["name", "createdAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
})
export type ${E}ListQuery = z.infer<typeof ${E}ListQuerySchema>
export const ${E}ResponseSchema = z.strictObject({
  id: ${E}IdSchema,
  organizationId: OrganizationIdSchema,
  name: create${E}NameSchema(),
  createdAt: z.iso.datetime(),
}).meta({ id: "${E}Response" })
export type ${E}Response = z.infer<typeof ${E}ResponseSchema>
export const ${E}PageSchema = z.strictObject({
  items: z.array(${E}ResponseSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
}).meta({ id: "${E}Page" })
export type ${E}Page = z.infer<typeof ${E}PageSchema>
`
  )
  files.set(
    `apps/api/src/${d}/${d}.ts`,
    `import { Injectable, NotFoundException } from '@nestjs/common';
import type { Create${E}, ${E}ListQuery, ${E}Page, ${E}Response } from '@workspace/contracts';
import { createTenantRunner, type TenantContext } from '@workspace/database/tenant';
import { ${e}Repository } from '@workspace/database/repositories/${d}';
import { auditRepository } from '@workspace/database/repositories/audit';
import { AuthRuntime } from '../identity/auth-runtime';
import { TenantWrite } from '../tenancy/tenant-write';

@Injectable()
export class ${D} {
  constructor(private readonly runtime: AuthRuntime, private readonly writes: TenantWrite) {}
  async list(context: TenantContext, query: ${E}ListQuery): Promise<${E}Page> {
    return createTenantRunner(this.runtime.pool)(context, async (tx) => {
      const page = await ${e}Repository.list(tx, query);
      return { ...page, items: page.items.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })) };
    });
  }
  create(context: TenantContext, input: Create${E}, headers: Headers): Promise<${E}Response> {
    return this.writes.transaction(context, headers, [{ ${e}: ['create'] }], async (tx) => {
      const item = await ${e}Repository.create(tx, input);
      // 成功事实和审计共用事务，审计失败不能留下已创建资源。
      await auditRepository.record(tx, { eventCode: '${e}.created', resourceType: '${e}', resourceId: item.id, fields: {} });
      return { ...item, createdAt: item.createdAt.toISOString() };
    });
  }
  remove(context: TenantContext, id: string, headers: Headers): Promise<void> {
    return this.writes.transaction(context, headers, [{ ${e}: ['delete'] }], async (tx) => {
      const item = await ${e}Repository.remove(tx, id);
      if (!item) throw new NotFoundException();
      await auditRepository.record(tx, { eventCode: '${e}.deleted', resourceType: '${e}', resourceId: item.id, fields: {} });
    });
  }
}
`
  )
  const errors = [400, 401, 403, 500]
    .map(
      (status) =>
        `  @ApiResponse({ status: ${status}, standardSchema: ApiErrorSchema })`
    )
    .join("\n")
  files.set(
    `apps/api/src/${d}/${d}.controller.ts`,
    `import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import { ApiErrorSchema, Create${E}Schema, ${E}IdSchema, ${E}ListQuerySchema, ${E}PageSchema, ${E}ResponseSchema, OrganizationIdSchema, type Create${E}, type ${E}ListQuery, type ${E}Page, type ${E}Response } from '@workspace/contracts';
import type { TenantContext } from '@workspace/database/tenant';
import { CurrentTenant, RequireTenant } from '../tenancy/tenant.guard';
import { ${D} } from './${d}';

@ApiTags('${d}')
@Controller('organizations/:organizationId/${d}')
export class ${D}Controller {
  constructor(private readonly service: ${D}) {}
  @Get()
  @RequireTenant({ ${e}: ['read'] })
  @ApiOperation({ operationId: 'list${D}' })
  @ApiResponse({ status: 200, standardSchema: ${E}PageSchema })
${errors}
  list(@Param('organizationId', { schema: OrganizationIdSchema }) _organizationId: string, @Query({ schema: ${E}ListQuerySchema }) query: ${E}ListQuery, @CurrentTenant() context: TenantContext): Promise<${E}Page> { return this.service.list(context, query); }
  @Post()
  @RequireTenant({ ${e}: ['create'] })
  @ApiOperation({ operationId: 'create${E}' })
  @ApiResponse({ status: 201, standardSchema: ${E}ResponseSchema })
${errors}
  create(@Param('organizationId', { schema: OrganizationIdSchema }) _organizationId: string, @Body({ schema: Create${E}Schema }) input: Create${E}, @Headers() headers: IncomingHttpHeaders, @CurrentTenant() context: TenantContext): Promise<${E}Response> { return this.service.create(context, input, fromNodeHeaders(headers)); }
  @Delete(':${e}Id')
  @HttpCode(204)
  @RequireTenant({ ${e}: ['delete'] })
  @ApiOperation({ operationId: 'delete${E}' })
  @ApiResponse({ status: 204, description: '${E} deleted' })
  @ApiResponse({ status: 404, standardSchema: ApiErrorSchema })
${errors}
  remove(@Param('organizationId', { schema: OrganizationIdSchema }) _organizationId: string, @Param('${e}Id', { schema: ${E}IdSchema }) id: string, @Headers() headers: IncomingHttpHeaders, @CurrentTenant() context: TenantContext): Promise<void> { return this.service.remove(context, id, fromNodeHeaders(headers)); }
}
`
  )
  files.set(
    `apps/api/src/${d}/${d}.module.ts`,
    `import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { ${D} } from './${d}';
import { ${D}Controller } from './${d}.controller';
@Module({ imports: [TenancyModule], controllers: [${D}Controller], providers: [${D}] })
export class ${D}Module {}
`
  )
  files.set(
    `apps/tenant/src/features/${d}/${d}-query.ts`,
    `import { queryOptions } from "@tanstack/react-query"
import { organizationKeys, list${D} } from "@workspace/api-client"
import type { ${E}ListQuery } from "@workspace/contracts"

export const ${e}Keys = { all: (organizationId: string) => [...organizationKeys.scope(organizationId), "${d}"] as const }
export function ${e}ListOptions(organizationId: string, search: ${E}ListQuery, locale: string, authorizationVersion: number) {
  return queryOptions({
    queryKey: [...${e}Keys.all(organizationId), search, locale, authorizationVersion],
    queryFn: ({ signal }) => list${D}(organizationId, search, { signal }),
  })
}
`
  )
  files.set(
    `apps/tenant/src/features/${d}/${d}-route.tsx`,
    `import { useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { ${D}List } from "./${d}-list"
import type { ${E}ListQuery } from "@workspace/contracts"
const path = "/app/${d}/$organizationId"
export function ${D}Route() {
  const { organizationId } = useParams({ from: path })
  const search = useSearch({ from: path })
  const navigate = useNavigate({ from: path })
  return <${D}List key={organizationId} organizationId={organizationId} search={search} onSearchChange={(next: ${E}ListQuery) => void navigate({ search: next })} />
}
`
  )
  files.set(
    `apps/tenant/src/features/${d}/${d}-list.tsx`,
    listTemplate({ d, e, E, D, minimum, maximum })
  )
  for (const [locale, catalog] of Object.entries(catalogs(input)))
    files.set(
      `packages/i18n/src/locales/${locale}/${d}.json`,
      JSON.stringify(
        sortCatalog(
          Object.fromEntries(
            Object.entries(catalog).filter(
              ([key]) => !key.startsWith("permission")
            )
          )
        ),
        null,
        2
      ) + "\n"
    )
  files.set(
    `tests/unit/${d}-contracts.test.ts`,
    `import { describe, expect, it } from "vitest"
import { Create${E}Schema, ${E}ListQuerySchema } from "../../packages/contracts/src/${d}.ts"
describe("${d} contracts", () => {
  it("rejects client-selected organization and invalid names", () => {
    expect(Create${E}Schema.safeParse({ name: "", organizationId: "untrusted" }).success).toBe(false)
    expect(Create${E}Schema.safeParse({ name: "x".repeat(${maximum + 1}) }).success).toBe(false)
    expect(Create${E}Schema.safeParse({ name: "😀".repeat(${minimum}) }).success).toBe(true)
    expect(Create${E}Schema.parse({ name: " " + "x".repeat(${minimum}) + " " }).name).toHaveLength(${minimum})
  })
  it("uses bounded page pagination and an explicit sort allowlist", () => {
    expect(${E}ListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20, sortBy: "createdAt", sortOrder: "desc" })
    expect(${E}ListQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false)
    expect(${E}ListQuerySchema.safeParse({ sortBy: "organizationId" }).success).toBe(false)
  })
})
`
  )
  return files
}

function listTemplate({ d, e, E, D, minimum, maximum }) {
  return `import { useEffect, useId, useMemo, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { FormDialog, ResourceList } from "@workspace/admin"
import { DataTable, DataTableColumnHeader } from "@workspace/admin/data-table"
import type { DataTableProps, DataTableStatus } from "@workspace/admin/data-table"
import { ApiClientError, create${E}, delete${E}, getOrganizationAccessOptions, organizationKeys } from "@workspace/api-client"
import { Create${E}Schema, create${E}NameSchema, type ${E}ListQuery, type ${E}Response } from "@workspace/contracts"
import { useUiLocale } from "@workspace/i18n/react"
import { Button } from "@workspace/ui/components/button"
import { Field, FieldError, FieldLabel } from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@workspace/ui/components/alert-dialog"
import { authClient } from "@/lib/auth-client"
import { ${e}Keys, ${e}ListOptions } from "./${d}-query"

const createSchema = (message: string) => Create${E}Schema.extend({ name: create${E}NameSchema(message) })
const empty: ${E}Response[] = []
export function ${D}List({ organizationId, search, onSearchChange }: { organizationId: string; search: ${E}ListQuery; onSearchChange: (next: ${E}ListQuery) => void }) {
  const { t } = useTranslation(["${d}", "common"])
  const locale = useUiLocale()
  const client = useQueryClient()
  const access = useQuery(getOrganizationAccessOptions(organizationId))
  const version = access.data?.data.authorizationVersion ?? 0
  const permissions = useQuery({
    queryKey: [...organizationKeys.scope(organizationId), "${d}-permissions", version],
    retry: false,
    enabled: access.isSuccess && access.data.data.status === "ACTIVE",
    queryFn: async ({ signal }) => {
      const check = async (action: "read" | "create" | "delete") => {
        const result = await authClient.organization.hasPermission({ organizationId, permissions: { ${e}: [action] }, fetchOptions: { signal } })
        if (result.error) throw new Error(result.error.message)
        return result.data.success
      }
      const [read, create, remove] = await Promise.all([check("read"), check("create"), check("delete")])
      return { read, create, remove }
    },
  })
  const allowed = access.isSuccess && !access.isError && access.data.data.status === "ACTIVE" && permissions.isSuccess && !permissions.isError
  const canRead = allowed && permissions.data.read
  const query = useQuery({ ...${e}ListOptions(organizationId, search, locale, version), enabled: canRead })
  useEffect(() => {
    if (permissions.isError || access.isError || (permissions.isSuccess && !permissions.data.read) || query.error instanceof ApiClientError && query.error.body.code === "FORBIDDEN") {
      void client.cancelQueries({ queryKey: ${e}Keys.all(organizationId) })
      client.removeQueries({ queryKey: ${e}Keys.all(organizationId) })
    }
  }, [client, organizationId, permissions.isSuccess, permissions.data?.read, permissions.isError, access.isError, query.error])
  const id = useId()
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  const [removing, setRemoving] = useState<${E}Response | null>(null)
  const [removeFailed, setRemoveFailed] = useState(false)
  const form = useForm({
    defaultValues: { name: "" },
    validators: { onSubmit: createSchema(t("${d}:nameInvalid")) },
    onSubmit: async ({ value, formApi }) => {
      setFailed(false)
      try { await create${E}(organizationId, Create${E}Schema.parse(value)); await client.invalidateQueries({ queryKey: ${e}Keys.all(organizationId) }); formApi.reset(); setOpen(false) }
      catch { setFailed(true) }
    },
  })
  const remove = useMutation({
    mutationFn: async (item: ${E}Response) => { await delete${E}(organizationId, item.id) },
    onSuccess: async () => { setRemoving(null); await client.invalidateQueries({ queryKey: ${e}Keys.all(organizationId) }) },
    onError: () => setRemoveFailed(true),
  })
  const columns = useMemo<DataTableProps<${E}Response>["columns"]>(() => [
    { accessorKey: "name", header: ({ header }) => <DataTableColumnHeader header={header} title={t("${d}:name")} />, meta: { label: t("${d}:name") }, cell: ({ row }) => <span className="wrap-anywhere">{row.original.name}</span> },
    { accessorKey: "createdAt", header: ({ header }) => <DataTableColumnHeader header={header} title={t("${d}:createdAt")} />, meta: { label: t("${d}:createdAt") }, cell: ({ row }) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(row.original.createdAt)) },
    { id: "actions", header: t("${d}:actions"), enableSorting: false, cell: ({ row }) => allowed && permissions.data.remove ? <Button variant="ghost" onClick={() => { setRemoveFailed(false); setRemoving(row.original) }}>{t("${d}:remove")}</Button> : null },
  ], [locale, t, allowed, permissions.data])
  const denied = permissions.isSuccess && !canRead || query.error instanceof ApiClientError && query.error.body.code === "FORBIDDEN"
  const status: DataTableStatus = denied ? "forbidden" : permissions.isError || access.isError || query.isError ? "error" : !canRead || query.isPending ? "loading" : query.isFetching ? "refreshing" : "ready"
  const sorting = [{ id: search.sortBy, desc: search.sortOrder === "desc" }]
  return <ResourceList title={t("${d}:title")} status="ready" actions={allowed && permissions.data.create ? <Button onClick={() => { setFailed(false); setOpen(true) }}>{t("${d}:create")}</Button> : undefined}>
    <DataTable columns={columns} data={canRead && !denied ? query.data?.data.items ?? empty : empty} getRowId={(item) => item.id} rowCount={canRead && !denied ? query.data?.data.total ?? 0 : 0} status={status}
      onRetry={() => { void access.refetch(); void permissions.refetch(); void query.refetch() }}
      manualPagination manualFiltering manualSorting enableMultiSort={false}
      searchPlaceholder={t("${d}:search")}
      state={{ globalFilter: search.name ?? "", pagination: { pageIndex: search.page - 1, pageSize: search.pageSize }, sorting }}
      onGlobalFilterChange={(updater) => { const next = typeof updater === "function" ? updater(search.name ?? "") : updater; onSearchChange({ ...search, page: 1, name: typeof next === "string" && next.trim() ? next.trim() : undefined }) }}
      onPaginationChange={(updater) => { const next = typeof updater === "function" ? updater({ pageIndex: search.page - 1, pageSize: search.pageSize }) : updater; onSearchChange({ ...search, page: next.pageSize === search.pageSize ? next.pageIndex + 1 : 1, pageSize: next.pageSize }) }}
      onSortingChange={(updater) => { const next = typeof updater === "function" ? updater(sorting) : updater; onSearchChange({ ...search, page: 1, sortBy: next[0]?.id === "name" ? "name" : "createdAt", sortOrder: next[0]?.desc === false ? "asc" : "desc" }) }}
      onResetFilters={() => onSearchChange({ ...search, page: 1, name: undefined })}
    />
    {allowed && permissions.data.create && <form.Subscribe selector={(state) => state.isSubmitting}>{(pending) => <FormDialog open={open} onOpenChange={setOpen} title={t("${d}:create")} description={t("${d}:createDescription")} onSubmit={() => void form.handleSubmit()} pending={pending} error={failed ? t("common:operationFailed") : undefined} submitLabel={t("common:save")}>
      <form.Field name="name">{(field) => { const invalid = field.state.meta.isTouched && !field.state.meta.isValid; return <Field data-invalid={invalid}><FieldLabel htmlFor={id}>{t("${d}:name")}</FieldLabel><Input id={id} name={field.name} required minLength={${minimum}} maxLength={${maximum * 2}} value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} onBlur={field.handleBlur} aria-invalid={invalid} />{invalid && <FieldError errors={field.state.meta.errors} />}</Field> }}</form.Field>
    </FormDialog>}</form.Subscribe>}
    <AlertDialog open={!!removing && allowed && permissions.data.remove} onOpenChange={(value) => { if (!value && !remove.isPending) setRemoving(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("${d}:remove")}</AlertDialogTitle><AlertDialogDescription>{t("${d}:removeDescription")}</AlertDialogDescription></AlertDialogHeader>{removeFailed && <p role="alert">{t("common:operationFailed")}</p>}<AlertDialogFooter><AlertDialogCancel disabled={remove.isPending}>{t("common:cancel")}</AlertDialogCancel><AlertDialogAction disabled={remove.isPending} onClick={(event) => { event.preventDefault(); if (removing) remove.mutate(removing) }}>{t("${d}:remove")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </ResourceList>
}
`
}

export function accessSql(input) {
  const { table } = input
  return `-- 租户范围由 TenantTx 设置；没有 scope 时不能读写，运行身份不获得迁移权限。\nGRANT SELECT, INSERT, DELETE ON public."${table}" TO app_runtime;\nALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY;\nALTER TABLE public."${table}" FORCE ROW LEVEL SECURITY;\nCREATE POLICY "${table}_tenant_scope" ON public."${table}"\n  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)\n  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);\n`
}
