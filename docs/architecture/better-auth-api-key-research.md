# Better Auth API Key 1.7.5 研究

调查范围：只核实本仓库已安装的 Better Auth / `@better-auth/api-key` 1.7.5 能力与官方资料版本；没有改仓库、运行服务或访问任何凭据值。

## 版本证据

- 本地包元数据确认 `better-auth` 与 `@better-auth/api-key` 均为 `1.7.5`。插件公开 `.` 与 `./client` 两个导出：服务端 `apiKey` 从 `@better-auth/api-key` 导入，客户端 `apiKeyClient` 从 `@better-auth/api-key/client` 导入。（本地：`packages/database/node_modules/@better-auth/api-key/package.json`）
- Better Auth 官方 API Key 文档当前显示 Latest Version `1.7.10`；文档页是滚动最新版资料，不能单独作为 1.7.5 的版本证据。官方 `llms.txt` 被浏览工具以 `text/markdown` 类型拒取；版本判断用官方文档页标识，并以本地 1.7.5 包和官方 Git tag 源码交叉确认。
- 1.7.5 一手源码：[插件入口 `index.ts`（v1.7.5）](https://github.com/better-auth/better-auth/blob/v1.7.5/packages/api-key/src/index.ts)。本地安装的 1.7.5 dist 为实际解析版本依据。

## 1.7.5 插件原生能力

- 服务端插件 `apiKey()` 合并 API Key schema，提供 `apikey` 表；需要随 Better Auth adapter / schema 迁移生成。默认 key 存数据库，配置也允许 secondary storage/custom storage。
- 客户端插件由 `apiKeyClient()` 注册，声明 create/delete/delete-all-expired HTTP 方法并让插件 API 类型可用。服务端端点/API 名称：`createApiKey`、`verifyApiKey`、`getApiKey`、`updateApiKey`、`deleteApiKey`、`listApiKeys`、`deleteAllExpiredApiKeys`；客户端有对应 CRUD/list 方法（verify 与 delete-all-expired 是 server-only API）。官方当前文档的安装示例与端点说明：[API Key 文档](https://better-auth.com/docs/plugins/api-key)。
- 创建时原始 key 只在创建结果中返回；数据库记录存 key 哈希（默认 SHA-256）及用于识别的前缀/开头字符。list/get/update 不返回原始 key。
- 内置校验支持有效性、启用/过期状态、request limit / refill，以及可选 key permissions；`verifyApiKey` 可以要求权限并返回 key 元数据。实际业务资源授权仍须由调用方依据校验结果执行，插件的 key permission 校验自身不会替业务 API 建立资源访问策略。

## 用户 key、组织 key 与 session

- 默认 `references: "user"`，key 的 `referenceId` 指用户 ID；配置可设 `references: "organization"`，该配置下 `referenceId` 指组织 ID，创建需传 organizationId。
- 组织 key 不是只靠 org ID 过滤：插件要求 Better Auth Organization 插件存在，且操作人必须是该组织成员并拥有对应的 apiKey create/read/update/delete 权限；其授权沿用 Organization access control。Organization keys 与 user keys 由不同配置类型区分。
- `enableSessionForAPIKeys` 在 1.7.5 类型中默认为 `false`，说明文字明确警告不建议生产启用，可能引发安全问题。开启后，API Key 插件在 Better Auth 请求处理前验证 header key，并构造放进 Better Auth context 的模拟 user session；此机制仅接受 user-referenced key，组织 key 会返回 unauthorized。因此它不是组织 API key session 能力，也不是一般 Nest 业务路由的自动守卫。
- 该选项不应与 `verifyApiKey` 混为一谈：前者尝试让 Better Auth 的 session 流程识别 key；后者是显式服务端校验 API，可由业务 API 在自己的入口调用，再按业务约束授权。

## 原生管理端点与业务接口边界

- 管理 key 的原生端点需要 Better Auth session（用户归属会绑定当前会话用户；组织归属再校验 Organization 权限）。服务端在无 session header 的内部调用时，可对用户 key显式传 userId；组织 key需组织 ID并传有权限的 userId。key 本身只在创建时发给调用者。
- 插件只提供 key 生命周期、验证、速率/次数与可选 key-level permissions。它没有本项目业务资源的组织归属、具体业务权限或自定义返回契约；对受控业务 API 的准入应通过应用自己提供的服务端入口完成验证和业务授权。不要把插件的通用 `/api-key/*` CRUD 端点直接等同于应用现有的受控 credential 业务 API。

## 主要来源

- [Better Auth API Key 官方文档（当前页面 Latest Version 1.7.10）](https://better-auth.com/docs/plugins/api-key)
- [Better Auth `@better-auth/api-key` v1.7.5 插件入口源码](https://github.com/better-auth/better-auth/blob/v1.7.5/packages/api-key/src/index.ts)
- 本仓库安装源码：`packages/database/node_modules/@better-auth/api-key/dist/index.mjs`、`dist/client.mjs`、`dist/types-y22rgFHR.d.mts`，以及包元数据 `package.json`；上述版本能力结论以这些 v1.7.5 实际解析产物为准。
