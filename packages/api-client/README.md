# Business API client

`/api/v1/*` 使用本包，认证与组织操作仍使用 Better Auth Client。

## 使用

应用启动时配置公开 API origin；同源部署可使用 `window.location.origin`。浏览器请求统一携带会话凭据，Node 测试可通过 `getHeaders` 提供测试会话。

```ts
import { configureApiClient, useProjectsList } from "@workspace/api-client"

configureApiClient({ baseUrl: window.location.origin })

// organizationId 与列表参数来自 Router，locale 来自 UI i18next 状态。
const query = useProjectsList(organizationId, params, locale)
```

`useProjectsList` 调用 Orval 生成的 hook。`getProjectsListOptions` 供 Query Client/Router loader 使用；两者都要求明确的 `zh-CN`、`en-US` 或 `ar`，并将同一个 locale 快照传入 Query Key 和 Accept-Language。生成 hook 的 Query Key 经 Orval 配置调用 `projectKeys`，不按用户增加首版不存在的数据范围。

列表 key 包含组织、规范化查询条件和请求语言，详情 key 包含组织、资源 ID 和请求语言。`projectKeys.all(organizationId)` 用于组织内 Projects 的失效前缀。详情 API 与页面操作在 S7 交付。

直接 HTTP 调用使用生成的 `listProjects(organizationId, params, headers)`，可省略语言 Header 让服务器协商。HTTP 响应为 `{ data, status, headers }`；失败抛出 `ApiClientError`，使用 `error.body.code` 判断业务错误，不匹配 `message`。网络与协议解析错误保持原始异常。

## 生成与验证

```sh
pnpm api:openapi
pnpm api:generate
pnpm api:check
```

`src/generated` 只能由 Orval 重生成。SDK 与 hooks 均由同一份 OpenAPI 快照产生；错误类型通过 HTTP mutator 映射到 `ApiClientError`。`api:check` 比较重生成前后的完整文件集合与内容，包括新增和删除文件。CI 另外检查生成目录与 Git 无漂移。
