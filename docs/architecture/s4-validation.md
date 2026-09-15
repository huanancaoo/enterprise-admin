# S4：认证、租户解析与授权验收

日期：2026-09-15。

## 交付范围

S4-01 至 S4-07 已完成。前序实现详见 [S4-01](s4-01-validation.md)、[S4-02](s4-02-validation.md)、[S4-03](s4-03-validation.md)、[S4-04](s4-04-validation.md)；这些记录保留各次执行时的范围和边界，本记录汇总当前阶段结果。

- S4-05：`packages/permissions` 统一定义 read/create/update/delete/export/translate 动作、Better Auth 权限声明与 API 请求类型。认证配置直接引用目录，不重复维护完整动作列表；未新增角色模型或导出功能。
- S4-06：`RequireTenant` 在处理器执行前通过身份、成员、组织状态及动作权限检查。`ProjectPolicy.requireForMutation` 只接受 TenantTx，在同一事务中按组织与资源 ID 查询并锁定资源，之后才执行修改。不存在或跨组织资源返回 404。根据 ADR-0004，不附加负责人、创建者或归档状态限制。
- S4-07：真实 HTTP 写操作验证登出、成员撤销、角色降级和组织停用后的拒绝行为。既校验状态码，也断言处理器未进入、目标资源及另一组织资源仍存在；有效授权下先成功删除对照资源，防止测试因端点本身不可用而产生假阳性。

正式应用注册 IdentityService、AuthorizationService、TenantContextService、TenantGuard 和 ProjectPolicy。组织启用状态及数据库列权限沿用 S4-04，现有组织和新建组织默认启用。

## 授权与事务次序

```text
路由目标 organizationId
  → 当前 Session / Membership / enabled / 动作权限
  → 不可变 TenantContext
  → 业务处理器
  → runInTenant / transaction-local 组织值
  → ProjectPolicy 读取并锁定当前组织资源
  → 修改
  → 提交
```

测试写端点只在 `apps/api/test/auth.e2e-spec.ts` 的测试模块注册，调用正式 Guard、Policy、Repository 和 PostgreSQL。它不发布到生产应用，不作为已交付 Projects 产品 API；S7 的生产变更还必须接入同事务审计。

## 实际检查

| 检查                                              | 结果                                                 |
| ------------------------------------------------- | ---------------------------------------------------- |
| `pnpm lint`（含 `lint:boundaries`）               | 通过                                                 |
| `pnpm typecheck`                                  | 通过                                                 |
| `pnpm test:unit`                                  | 工程边界 6 项、API 单元 4 项通过                     |
| `pnpm test:api`                                   | 2 个文件、10 项通过                                  |
| `pnpm --filter @workspace/database test:database` | 2 个文件、13 项通过                                  |
| `pnpm --filter @workspace/database schema:check`  | 无漂移                                               |
| `pnpm test:e2e`                                   | 真实浏览器认证回归 6 项通过；此前置步骤包含 API 构建 |

HTTP 场景还覆盖非法 UUID、无会话、非成员、跨组织资源 ID、伪造身份参数与 requestId、A/B 并发上下文隔离、动态角色权限变化、普通 runtime 无权修改 enabled，以及停用 A 不影响 B。

既有浏览器测试覆盖登录、组织选择等认证流程。撤权后的旧客户端写入由真实 HTTP 请求复现，不宣称已有 Projects 页面或按钮完成了浏览器业务验收。

## 尚未完成的后续范围

- S5–S7 的契约生成、完整语言协商、Projects 产品接口、页面及审计闭环仍按实施计划推进。当前请求上下文语言仍为平台初始值 zh-CN。
- 平台启停 HTTP 操作、平台授权和审计属于 S8；平台数据库通道不等于平台请求已授权。
- 新迁移只在测试数据库执行，未迁移开发或生产数据库。未提交、推送。
- 未执行全仓 `verify`。额外执行 `pnpm peers check` 未通过：HEAD 锁文件已存在的 Tiptap 菜单扩展 3.31.3 要求 core/pm 3.31.3，而当前二者为 3.30.3。本次锁文件只新增 API、Database 到 permissions 的 workspace 链接，未改变该依赖组合。 后续按用户要求将 Tiptap 统一至 3.31.3，`pnpm peers check` 已通过；仍未执行全仓 `verify`。

测试使用 Node 26.8.2、临时 PostgreSQL 和 Chromium。权限变化影响后续请求，不承诺中断已经开始的请求。
