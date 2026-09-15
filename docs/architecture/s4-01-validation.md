# S4-01：NestJS Express 与 Better Auth 接入验证

## 交付范围

- API 启动入口通过 `createApplication` 创建 Nest Express 应用，复用 `packages/database` 的 Better Auth/Organization 配置和既有迁移。
- `/api/auth/*` 由 Better Auth Node handler 处理；先注册认证路由，再启用业务 JSON/urlencoded 解析。认证请求保留服务端 requestId，业务路由继续使用 `/api/v1`，Swagger 只描述业务接口。
- `AuthRuntime` 只使用 `DATABASE_URL` 的 runtime 连接；Nest 关闭时释放连接池。启动配置不读取迁移或平台数据库凭据。
- Admin、Platform 各自从 `src/lib/auth-client.ts` 导出 React Better Auth Client，包含 Organization Client 和动态角色客户端能力。后续认证操作使用该入口，不进入 Orval 业务 SDK。
- 两个 Vite 开发服务器把 `/api/auth` 代理到本地 API。生产部署需在各前端域名下将该路径反向代理到 API，保留 Cookie、Origin 和 Set-Cookie；本次不增加跨域直连方式。
- 数据库包提供编译后的 JavaScript/类型出口，供 Nest 生产构建加载。Turbo 的开发、类型检查任务先构建依赖；根目录 `test:api` 也先构建数据库包。

## 运行前提

使用仓库固定的 Node 26.8.2 和 pnpm 12.4.1。先按 S2 完成数据库初始化和迁移，再按 `apps/api/.env.example` 向 API 进程注入：

- `DATABASE_URL`：`app_runtime` 连接。
- `BETTER_AUTH_URL`：认证服务的公开地址；本地为 `http://localhost:3000`。
- `BETTER_AUTH_SECRET`：随机生成的至少 32 字符密钥。
- `BETTER_AUTH_TRUSTED_ORIGINS`：逗号分隔的可信前端 Origin；本地为 `http://localhost:3200,http://localhost:3201`。

配置文件不会自动加载。根目录 `pnpm dev` 会构建依赖后启动开发任务；单独执行 API 命令前先运行 `pnpm --filter @workspace/database build`。生产先执行 `pnpm build`，再运行 `pnpm --filter api start:prod`。

## 验证结果

2026-09-15，使用独立临时 PostgreSQL 容器和随机测试凭据：

| 检查                                          | 结果                                                                             |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| API E2E                                       | 8/8 通过，其中新增认证链路 4 项                                                  |
| Better Auth Client → HTTP → runtime 数据库    | 注册、登录、Cookie 会话读取、Organization 列表、登出通过                         |
| HTTP 安全与路由                               | 非可信 Origin 返回 403；旧 Cookie 会话失效；错误密码返回 401；认证与业务路径分离 |
| 连接释放                                      | 应用关闭后 runtime Pool 已结束                                                   |
| `pnpm --filter @workspace/database verify:s2` | Schema 重生成无漂移；数据库分权与 S3 隔离共 13/13 通过                           |
| `pnpm test:unit`                              | 根目录 6/6、API 1/1 通过                                                         |
| `pnpm lint`、`pnpm typecheck`、`pnpm build`   | 通过                                                                             |
| 编译产物加载                                  | Node 能直接加载 `apps/api/dist/create-application.js` 及其认证依赖               |

Better Auth 1.7.5 在测试环境默认跳过 Origin 校验；共享配置显式保留 Origin 和 CSRF 检查，避免测试环境与生产 HTTP 安全语义不同。测试中的 Cookie jar 仅补充 Node 不具备的浏览器 Cookie 传输能力；没有替换认证服务或数据库。

## 验收边界

本次只完成 S4-01。登录/组织选择页面、IdentityService/AuthorizationService、可信 TenantContext 和业务权限 Guard 仍属于 S4-02 至 S4-07。当前 `/api/v1` 欢迎接口仍是公开入口，不能把本次认证传输验证视为完整 S4 授权验收。没有新增页面，也没有宣称完成浏览器业务流程验收。

## 接入依据

- [Better Auth Express 集成](https://better-auth.com/docs/integrations/express)
- [Better Auth Client](https://better-auth.com/docs/concepts/client)
