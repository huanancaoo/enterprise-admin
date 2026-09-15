# ADR-0004：Projects 参考领域业务基线

- 状态：已接受
- 日期：2026-09-15
- 对应任务：S0-07
- 业务范围：用户已明确确认

## 状态与权限

状态固定为 `draft`、`active`、`archived`，创建默认为 `draft`。在具有 `project:update` 权限时，三个状态可相互转换；写入同一状态不构成额外转换。归档项目仍可读取、编辑、翻译、恢复和删除，不附加“归档即只读”语义。

首版项目权限作用于整个组织：`project:read/create/update/delete/export/translate`，不增加“仅负责人可编辑”等未确认的数据范围。`export` 只是权限声明，不要求 S7 实现导出功能。

## 查询与分页

列表路径是 `/api/v1/organizations/:organizationId/projects`，详情在其后追加 `/:projectId`。目标组织来自经授权的路径；Create/Update Body 不允许覆盖 organizationId。

| 字段      | 约定                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------ |
| page      | 从 1 开始的整数，默认 1                                                                                      |
| pageSize  | 1–100 的整数，默认 20                                                                                        |
| status    | 可选单个状态；未提供时返回三个状态                                                                           |
| name      | 可选名称子串，去掉首尾空白；空串不施加名称条件；按解析后的显示名称执行大小写不敏感匹配，`%`/`_` 视为普通字符 |
| sortBy    | `createdAt` 或 `updatedAt`，默认 `createdAt`                                                                 |
| sortOrder | `asc` 或 `desc`，默认 `desc`                                                                                 |

时间相同时按 `id ASC` 排序，确保相同数据集的分页顺序确定。列表返回：

```ts
type ProjectPage = {
  items: ProjectResponse[]
  page: number
  pageSize: number
  total: number
}
```

`total` 为当前组织与筛选条件下的总数；越界页返回空 items，保留真实 total，不自动改写页码。首版采用 offset 分页，不声称并发新增/删除时页面快照不变。时间以 UTC ISO 8601 字符串返回；展示格式由 Intl 决定。

## 删除

DELETE 成功返回 204，硬删除 Project 及其所有译文。审计事件保留，资源 ID 为历史事实，不使用会随资源删除而级联删除的外键。不存在或不属于当前租户的资源返回 404；当前组织内没有删除权限则返回 403。首版不引入软删除、回收站或自动归档替代删除。

## 内容语言与译文解析

支持的语言为 `zh-CN`、`en-US`、`ar`。平台初始默认语言是 `zh-CN`；组织的 defaultLocale 初始化为平台默认值，用户可在后续设置流程中修改。

每个 Project 创建时固定 `contentLocale`：Create 未指定时读取组织 defaultLocale；明确指定时须为受支持语言。创建必须同时保存该语言的名称和描述；contentLocale 在首版不可修改。之后组织默认语言变化不迁移已有项目内容语言。

名称与描述存于 `project_translations`。每条译文保存非空名称和可空描述（null 表示没有描述）；名称去掉首尾空白后不能为空。基础译文必须随 Project 一同创建，并在 Project 存续时始终存在。所有写入同时遵守组织范围、复合外键与 RLS。

响应按以下确定规则选取**整条译文**：

1. 先按原架构的语言协商顺序确定请求 locale：受支持的 Accept-Language → user.preferredLocale → organization.defaultLocale → platformDefaultLocale。
2. 若有该 locale 的译文，使用它。
3. 若没有，使用该 Project 的 contentLocale 译文。

不逐字段混合不同语言；已有译文的 null 描述保持 null。基础译文缺失是数据完整性错误，不显示空名称、key 或机器翻译结果。响应包含 `contentLocale` 和实际使用的 `resolvedLocale`。

列表名称筛选对相同解析规则得出的名称执行，保证用户能以当前显示名称搜索。列表与详情表示都会随请求 locale 变化，所以两者 Query Key 都包含 organizationId 和请求 locale；当前首版没有按用户区别的数据范围，不增加 userScope 维度。Content-Language 表示本次协商出的响应语言，单条内容的实际语言以 resolvedLocale 为准。

## 一致性与后续验收

Project 创建/修改/删除、译文变更与对应审计事实同一事务提交；API、数据库、SDK 和页面共同采用本 ADR。S7 覆盖状态互转、默认分页、筛选与稳定次序、硬删除译文但保留审计、组织默认语言变化后的既有内容，以及指定语言无译文时的解析结果。
