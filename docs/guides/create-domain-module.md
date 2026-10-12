# 新增租户业务领域

目标是让新领域沿用框架的身份、权限、隔离、契约和前端状态规则。Projects 是现有完整参考；同步租户写入使用 `TenantWrite`，不把 Projects 或 Files 的专用写入流程复制到新领域。

## 先确定事实和授权

先写出实体、组织归属和操作，再明确名称等字段的约束、角色授予及成功审计。唯一性必须来自业务事实；不要仅因为页面有名称字段就增加名称唯一约束。平台运营、全局身份与租户业务不混放。参考 `apps/api/CONTEXT.md`、`packages/database/README.md` 和根 `CONTEXT-MAP.md`。

一个足够验证接入路径的最小领域包含 UUID、组织 ID、名称、列表、创建和删除；创建/删除写成功审计。它不需要队列、第二套认证、第二个 SQL Pool 或第二个 Query Client。

## 正式注册位置

| 层         | 需要修改的入口                                                                                                                                                 | 接入后应验证的结果                                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 数据库     | `packages/database/src/schema/<domain>.ts`、`src/repositories/<domain>.ts`、`package.json` 的 Repository export                                                | Schema 被 Drizzle 发现；其他服务端包能从包入口导入 Repository                     |
| 权限       | `packages/permissions/src/index.ts` 的动作、`permissionStatements`、`PermissionRequest`、内置角色声明；允许自定义角色授予时同时加入 `delegableRolePermissions` | 服务端与现有认证客户端自动读取同一动作声明；成员不能通过新页面获得未授予的动作    |
| 契约       | `packages/contracts/src/<domain>.ts` 与 `src/index.ts`                                                                                                         | 输入、响应和 ID 由正式 Zod Schema 定义并导出                                      |
| HTTP       | `apps/api/src/<domain>` 的业务实现、Controller、Nest Module，以及 `AppModule.forRoot`                                                                          | Controller 声明授权；Module 导入 `TenancyModule`；领域进入真实应用和 OpenAPI 导出 |
| 客户端     | `apps/api/openapi/openapi.json`、Orval 生成目录、`packages/api-client/src/index.ts`                                                                            | 生成请求与响应类型；包入口导出正式 SDK，生成文件不手写                            |
| 页面       | `apps/tenant/src/features/<domain>`、`src/router.tsx`、`components/admin-layout.tsx`                                                                           | 正式路由、导航、面包屑和组织切换指向同一 Feature                                  |
| 文案       | 三个 `packages/i18n/src/locales/<locale>/<domain>.json`、`src/resources.ts`、`scripts/check-catalogs.mjs`                                                      | namespace 注册完整；类型、三语言键和插值参数一致；Arabic 使用既有 RTL Provider    |
| 展示与验收 | 同一 Feature 的 Storybook、`packages/mocks` fixtures、`tests/api`、`tests/e2e`；新增表还更新数据库测试的正式表目录                                             | 展示状态有交互证据；业务事实、授权及隔离另有真实 HTTP/浏览器证据                  |

## Schema、迁移与隔离

在 `packages/database/src/schema` 定义租户业务表，组织列必须非空，资源归属使用数据库外键；必要的名称、唯一性和资源关系由数据库约束表达。通过正式生成链生成结构迁移：

```sh
pnpm db:generate
pnpm --filter @workspace/database exec drizzle-kit generate --custom --name=<domain>-access
pnpm db:check
```

将手写的授权与 RLS SQL 放入刚生成的 custom migration。迁移必须明确表名、`app_runtime` 必要操作、ENABLE/FORCE RLS，以及按 `app.organization_id` 校验的 USING/WITH CHECK 策略。UUID 主键不需要序列授权；没有更新动作的领域不授予 UPDATE。已执行 migration 不修改，custom migration 和结构 migration 都进入同一 ledger。

`db:check` 检查认证 Schema 生成漂移，不证明新增业务表的授权、约束或 RLS 已正确。按 [数据库说明](../../packages/database/README.md) 仅以 `app_migrator` 执行真实 migration；API/Worker 不获得迁移凭据。新的独立测试数据库同样先执行正式 bootstrap 与 one-shot migration，不用测试专用 CREATE TABLE 代替迁移。

Repository 只接受 `TenantTx`。插入的组织 ID 来自 `tx.context`；读取和删除同时限定资源 ID 与当前组织。不要在 Repository 创建 Pool，或把请求体中的 organizationId 当成授权上下文。新增 Repository 必须通过数据库包 export 导出。

真实 PostgreSQL 验证包括本组织读写、另一组织的资源 ID 拒绝、无 scope 无法取得数据、实际约束拒绝、事务回滚、重复迁移和并发请求不串组织。Repository 的业务结果从正式 HTTP 读回；只有隔离/迁移 seam 使用独立观察身份核对 owner、GRANT、RLS 和约束。

## Policy、Contract 与 HTTP 写入

把领域动作加入固定权限声明，并明确 owner/admin/member 与自定义角色的实际授予。不要借用 `project:create` 等别的领域动作来控制新领域；现有 Better Auth 服务端和客户端都会读取 `packages/permissions`，无需另建认证配置。

在 contracts 定义严格输入、响应及必要的稳定错误 code，复用已有组织 ID、语言、分页和 API 错误结构。Controller 只承担 HTTP 适配：验证路由参数和 body，声明 `@RequireTenant`，通过 `@CurrentTenant` 获取可信上下文，把原始请求 headers 转为 `Headers` 传入业务实现。

同步租户写入注入 `apps/api/src/tenancy/tenant-write.ts` 的 `TenantWrite`，通过 `TenancyModule` 导入。调用形状如下；每个数组元素是一组必须同时满足的动作，多个元素表示授权的任选分支：

```ts
return this.writes.transaction(
  context,
  headers,
  [{ label: ["create"] }],
  async (tx) => {
    const label = await labelRepository.create(tx, input)
    await auditRepository.record(tx, {
      eventCode: "label.created",
      resourceType: "label",
      resourceId: label.id,
      fields: { name: label.name },
    })
    return label
  }
)
```

`TenantGuard` 完成请求入口授权，`TenantWrite` 再以同一个持锁连接检查当前 Session/API Key、组织状态、成员和动作，在业务工作前后终审；拒绝或异常回滚业务与审计。只在 Controller 查一次权限，或自行开启 TenantTx 后忽略当前身份复核，不能替代这一流程。

`auditRepository.record` 的 `resourceType` 必填。组织、actor 和 requestId 来自 TenantTx；资源删除不删除历史审计。数据库 `fields` 是存储事实，租户审计 HTTP 的 `metadata` 是经过批准字段白名单的投影；新事件默认不公开原始 fields。需要展示新领域 metadata 时，先明确可公开字段，再在 `OrganizationAuditEvents` 的投影规则显式声明。

涉及 Files usage、引用或外部对象操作时继续使用所属 Files 流程；其锁序不能替换为普通租户写事务。普通读取沿用 `createTenantRunner` 和通过 TenantGuard 的可信 context，不新增连接池。

```sh
pnpm api:openapi
pnpm api:generate
pnpm api:check
```

审查 OpenAPI 与 Orval 差异，导出新 SDK；`api:check` 重放正式生成链并检测漂移。真实 HTTP 使用生成的 SDK 验证输入错误、未登录、缺权限、跨组织、成功写入、审计及写入失败回滚。

## 页面与单一状态来源

领域代码留在 `apps/tenant`，业务无关组合与公共 UI 分别留在 `packages/admin` 和 `packages/ui`。注册 Router、侧栏和组织切换时保留现有 AuthGate 及 QueryClient；页面使用应用已有的 `authClient` 查询领域动作，不重新创建认证客户端。

已应用筛选、分页和排序由 Router Search Params 持有；没有这些能力的最小列表无需添加无意义的 Search Params。服务端事实只放 TanStack Query；Query Key 以 `organizationKeys.scope` 为前缀，包含影响结果的语言。组织切换沿用现有组织缓存清理；当前读取授权失效后清掉不可再读的领域数据。

编辑草稿使用 TanStack Form；按 [表单规范](../agents/forms.md) 在组件外定义 Zod Schema，使用 `form.Field`、shadcn `Field`、FieldLabel 与 FieldError。失效条件为 touched 且 invalid；请求期间禁用可提交区域。服务端错误保留草稿，成功后从正式查询读回列表。危险删除用既有 AlertDialog 并验证取消、确认和焦点恢复。

新 namespace 不仅要写三个 JSON，也必须注册 `resources.ts` 和 catalog 检查入口，再生成翻译类型：

```sh
pnpm --filter @workspace/i18n exec i18next-cli types
pnpm i18n:check
```

UI 语言不写入后台 URL；内容语言与 UI 语言分离。Storybook 使用同一正式 Feature 和现有 Provider/MSW fixtures 验证加载、空态、失败、慢请求、权限、长文本、键盘/焦点与危险确认。这些证明展示规则；授权仍由真实服务端验证。

## 异步任务与外部副作用

确有队列需求时，按 [Worker 指南](worker.md) 定义严格任务类型、可信身份和稳定幂等键，在 API 与 Worker 组合入口注册同一任务。执行时重新核查当前组织、成员和权限；TenantTx 内一次提交业务事实、幂等收据和成功审计。外部 HTTP/SMTP 不在业务事务中等待，投递事实由所属能力持久化。

不要把通用任务、Files 操作与认证邮件合并为一种状态机。任务结果下载仍检查当前权限，旧提交成功不能成为撤权后继续读取数据的理由。

## 独立照做验证

独立开发者从隔离 checkout 按本文新增最小领域，从正式迁移一路接到生成 SDK 和真实浏览器。产品工作区有未提交基线时，记录基线 HEAD、精确非 ignored 源码清单和 hash；排除 .env、密钥、依赖与构建产物。演示源码保存在可重放 artifact，不纳入产品领域。

每个纵向步骤记录实际 red、修正和 green。至少验证创建/列表/删除、对应审计、跨组织、匿名和无权限、无 scope、约束、回滚与并发；浏览器另验表单错误、请求期间不能重复提交、服务端失败保留草稿、危险确认、只读权限和三语言/RTL。相关入口如下；按改动选择受影响的测试文件，报告不能把聚焦测试写成全套测试通过。

```sh
pnpm lint:boundaries
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:api
pnpm test:database
pnpm test:storybook
pnpm test:e2e
pnpm build
```

如必须绕过 TenantTx/RLS、手写重复 API 类型或建立第二套状态来源，先修正框架公共入口，再更新指南。记录源码 artifact、基线、命令、失败、修正、真实 HTTP/浏览器证据和未验证范围；阅读、类型或构建检查不能记作业务接入成功，也不能替代生产部署验收。
