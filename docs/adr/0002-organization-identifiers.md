# ADR-0002：统一 UUID 组织标识

- 状态：已接受
- 日期：2026-09-15
- 对应任务：S0-05

## 决策

组织 ID 使用 UUID v4。数据库存 PostgreSQL `uuid`，HTTP/TypeScript 表达为 UUID 字符串，Contract 使用 `z.uuid()`。项目统一称 `organizationId`，不再引入同义 tenantId，也不使用带前缀 ID、ULID 或混合 ID 类型。

Better Auth 设置 `advanced.database.generateId: 'uuid'`。认证 Schema 由同版 `auth@1.7.5` CLI 生成；认证主键、成员/邀请/角色中的组织外键均生成 UUID。

Better Auth 默认将 Session 的 `activeOrganizationId` 生成为 text。为避免组织标识存储类型分叉，在 `session.additionalFields.activeOrganizationId` 配置 `references: { model: 'organization', field: 'id', onDelete: 'set null' }`，并指定 `input: false`。实测 CLI 生成 UUID 外键，删除组织会清空这个可选工作区偏好。修改发生在认证配置，不手工修改生成 Schema。

`activeOrganizationId` 始终只是工作区偏好。每次业务请求仍须验证目标组织、Session、Membership、组织状态及权限。

## 全链路约束

| 位置                                                | 固定表达                                              |
| --------------------------------------------------- | ----------------------------------------------------- |
| organization.id                                     | uuid 主键                                             |
| member/invitation/organization_role.organization_id | uuid 外键                                             |
| session.active_organization_id                      | 可空 uuid 外键                                        |
| projects.organization_id                            | 非空 uuid 外键，引用 organization.id                  |
| project_translations.organization_id                | 非空 uuid；与 project_id 形成引用 projects 的复合外键 |
| TenantContext / URL / JSON                          | string，入口必须经 UUID Schema 校验                   |
| PostgreSQL 上下文                                   | set_config 保存 UUID 文本，比较时显式转换为 uuid      |

S3 的 RLS `USING` 与 `WITH CHECK` 使用同一个表达式：

```sql
organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid
```

PostgreSQL 自定义设置在事务结束后可能返回空字符串。`NULLIF` 将“未设置/已清空上下文”统一表达为 NULL，使条件不成立；它不会把无效的非空 ID 转换成默认租户。非法 UUID 在 HTTP 边界拒绝。

## 验证

S0 已用生成迁移初始化 PostgreSQL，并经真实 HTTP 完成创建组织与切换工作区；检查五个认证组织引用列均为 UUID，再以非 Owner 角色验证 UUID 业务外键与 RLS cast。完整 A/B 租户并发、撤权、回滚等隔离用例仍是 S3 的独立验收要求。
