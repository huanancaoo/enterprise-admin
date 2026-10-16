# Better Auth Multi Session 插件研究

研究日期：2026-10-16。本文以仓库锁定并安装的 Better Auth `1.7.5` 为实现依据；当前在线文档页标注 Latest Version `1.7.10`，因此只用来确认官方公开的集成入口，不将其行为描述直接当作 `1.7.5` 事实。版本锁定见 `pnpm-lock.yaml` 的 `better-auth@1.7.5`（约第 5957 行）及 `packages/admin/package.json`、`packages/database/package.json`、`apps/api/package.json`。

**已确认范围：** tenant 与 platform 均接入浏览器内的多账号保留、添加、切换、单账号退出和全部退出。本文记录版本研究、接入决策与本地验收。

## 接入面

官方文档的基本接法是在 Better Auth 服务端 `plugins` 加 `multiSession()`，浏览器的 `createAuthClient` 另加 `multiSessionClient()`；服务端提供 `auth.api.*`，客户端提供 `authClient.multiSession.*`。[官方插件文档](https://better-auth.com/docs/plugins/multi-session)；固定版本源码：[v1.7.5 `multi-session/index.ts`](https://raw.githubusercontent.com/better-auth/better-auth/v1.7.5/packages/better-auth/src/plugins/multi-session/index.ts)、[v1.7.5 `multi-session/client.ts`](https://raw.githubusercontent.com/better-auth/better-auth/v1.7.5/packages/better-auth/src/plugins/multi-session/client.ts)。

实现前读取的配置基线位于 `packages/database/src/auth.ts`：服务端已注册 `organization`、`twoFactor`、`lastLoginMethod`，尚无 `multiSession()`；共用客户端 `packages/admin/src/auth/client.ts` 已注册 organization、last-login-method、two-factor client plugin，尚无 `multiSessionClient()`。tenant 和 platform 的完整多账号切换范围现已确认；这两个入口均使用该共享服务端和客户端配置。实现接入时，`multiSession()` 应排在 `twoFactor()` 之后，原因及源码时序见“MFA”小节。

## Schema 与存储

`multiSession()` 返回的插件对象定义了 `id`、`endpoints`、`hooks`、`options` 和错误码，没有声明 `schema`；实现通过现存 session adapter 查找、创建/更新 Cookie 或删除 session。由此可确认该插件本身不要求增加 Better Auth 数据表或列。见固定版本源码的插件返回对象及三个 endpoint 实现；已安装源码副本为 `node_modules/.pnpm/better-auth@1.7.5_.../node_modules/better-auth/dist/plugins/multi-session/index.mjs`。

本项目已显式设定 `session.storeSessionInDatabase: true`，并在 `session` 上增加 `activeOrganizationId`。插件的查找/撤销访问的是 session adapter，因而本项目仍由数据库 session 记录支撑多会话操作；Redis secondary storage 的启用不替代这里显式保留的数据库 session。参见 `packages/database/src/auth.ts:886-903`。是否需要执行或生成迁移，不能仅从此插件推出；它自身没有 schema 增量。现有组织偏好 `activeOrganizationId` 与身份 session 绑定，因此切换身份后返回的是该身份自己的会话字段，不应假设插件会跨账号继承当前组织。

## 端点实际语义

- `listDeviceSessions`（`GET /multi-session/list-device-sessions`）读取当前请求 Cookie 中名字含 `_multi-` 的签名 Cookie，从其值取 session token，查询有效且未过期的 session，并按 `user.id` 去重；没有 Cookie 或无有效 token 时返回空数组。它列出的是当前浏览器请求携带的已保存身份 session，不是账户在其他浏览器/设备上的所有 session。返回项包含 session 和 user。源码：v1.7.5 文件第 75-119 行。
- `setActiveSession`（`POST /multi-session/set-active`）以请求体 token 构造对应的 `_multi-{token}` Cookie 名，读取并验证该签名 Cookie 后，使用 Cookie 中签名值查找 session，并调用 `setSessionCookie` 覆盖当前主 session Cookie。它要求请求者实际持有目标多会话 Cookie；过期或找不到 session 时清理该多会话 Cookie 并返回未授权。切换后插件 client 的 atom listener 会触发当前 auth client 的 `$sessionSignal`，从而重取当前 tab 的 session。源码：v1.7.5 文件第 135-201 行；client listener 在固定版本 `client.ts`。
- `revokeDeviceSession`（`POST /multi-session/revoke`）要求当前请求先通过 `sessionMiddleware`，然后同样验证请求体所指的多会话 Cookie；删除的是 Cookie 签名值对应的 session，不是直接信任请求体 token。它会过期对应多会话 Cookie。若撤销目标正是当前主会话，则从其余有效多会话中取第一个作为新主会话；没有可用项时清理主 session Cookie。若目标不是主会话，只撤销目标并返回成功。源码：v1.7.5 文件第 218-309 行。
- 常规 `signOut` 的插件 after-hook 会逐个验证当前请求的多会话 Cookie，清除这些 Cookie 并删除所引用的 session；它和核心 sign-out 一起使同一浏览器请求携带的账号会话全部退出。此语义仅覆盖该浏览器请求带来的多会话 Cookie，不表示撤销用户在其他设备上创建、而当前浏览器没有 Cookie 引用的 session。源码：v1.7.5 文件第 362-398 行；官方文档亦说明 sign-out 会撤销全部活动会话。[官方插件文档](https://better-auth.com/docs/plugins/multi-session#signout-and-revoke-all-sessions)

## `maximumSessions` 与“设备”边界

源码默认 `maximumSessions: 5`。关键限制是源码按当前请求中的 `_multi-` Cookie 数量计算，且把产生主 session Cookie 的本次登录计入；它计算的是请求携带的同一 Cookie scope 的 Cookie 集合，并非数据库中某用户的全设备 session 总数。创建新 session 时，同一 `user.id` 已存在的多会话 Cookie 所引用 session 会先清理，再计算数量；不同账号会共享这组 Cookie 数量上限。源码：v1.7.5 文件第 49-53、327-358 行。

达到数量后，源码路径是直接不创建本次登录对应的多会话 Cookie，并未拒绝登录或删除刚创建的 session。因而超限登录仍可把新 session 放进主 session Cookie，同时留下既有多会话 Cookie；它不是强制的会话总量上限，也不能保证第 N+1 个身份可通过列表切回。源码没有按用户维度或全设备维度的计数查询。在线文档对“最多 session”的文字比源码简单，判断应以已安装版本为准。

## MFA、组织、Cookie、跨标签页与缓存

- **MFA：** 插件顺序会影响未完成 MFA 的登录。v1.7.5 dispatch 会按 `plugins` 数组顺序串行 `await` 执行 after-hooks（`api/dispatch.ts` 的 `getHooks` 与 `runAfterHooks`）。`twoFactor` 在 `/sign-in/email` 的 after-hook 中检测到待 MFA 后会删除刚建的 session、清除 session Cookie，并调用 `setNewSession(null)`；`multiSession` 的 hook 匹配全部路径，但只在存在 `newSession` 且响应写有 session Cookie 时新增 `_multi-*` Cookie。因此若 `multiSession()` 排在 `twoFactor()` 前，它会在 MFA 清理之前读到临时 session，并可能留下指向已删除 session 的多会话 Cookie。将 `multiSession()` 放在 `twoFactor()` 后，pending MFA hook 先清空 `newSession`；成功验证时，two-factor endpoint 调用 `setSessionCookie` 建立最终 session，随后 multi-session hook 才保存该登录。源码：[v1.7.5 dispatch.ts](https://raw.githubusercontent.com/better-auth/better-auth/v1.7.5/packages/better-auth/src/api/dispatch.ts)、[v1.7.5 two-factor/index.ts](https://raw.githubusercontent.com/better-auth/better-auth/v1.7.5/packages/better-auth/src/plugins/two-factor/index.ts)、[v1.7.5 verify-two-factor.ts](https://raw.githubusercontent.com/better-auth/better-auth/v1.7.5/packages/better-auth/src/plugins/two-factor/verify-two-factor.ts)、[v1.7.5 multi-session/index.ts](https://raw.githubusercontent.com/better-auth/better-auth/v1.7.5/packages/better-auth/src/plugins/multi-session/index.ts)。官方 MFA 流程说明客户端自动传递 MFA/session Cookie；服务端连续调用则必须转发前一响应 Cookie。[官方 2FA 文档](https://better-auth.com/docs/plugins/2fa)。
- **组织：** 多会话 Cookie 保存的是身份 session token；插件不增加 organization 维度，也不定义 `activeOrganizationId` 的迁移或共享规则。切换账号切换到目标 session 所带的用户和 session 字段；应用仍需根据切换后的 session 重新读取授权及组织上下文。组织成员/角色权限不能因可切换会话而共享或推断。当前 `activeOrganizationId` 是 session additional field，见 `packages/database/src/auth.ts:886-901`。
- **Cookie 与 Origin：** 每个多身份 session 需要额外的签名 Cookie，名字由 session-token Cookie 名加 `_multi-{token}` 构成，并继承 session-token Cookie attributes。Cookie 的发送范围由 host/domain、path 和 secure 等属性决定，不按端口隔离。故两个 SPA 都以 `localhost` 为 host、仅端口不同（例如两个 preview server）时，浏览器 Cookie jar 对它们共享同 host 的 Cookie；端口不同仍是不同 Web Origin，跨端口 fetch 还需相应 CORS/credentials 配置。`localhost` 与 `127.0.0.1` 或两个不同 hostname 则是不同 host，host-only 默认 Cookie 各自独立；官方 Better Auth 文档说明跨子域共享须显式配置 `crossSubDomainCookies` 和共同 domain。Multi-session 插件本身不做跨域同步。[Better Auth Cookies 文档](https://better-auth.com/docs/concepts/cookies)；[RFC 6265 §8.5](https://www.rfc-editor.org/rfc/rfc6265.html#section-8.5) 明确指出 Cookie 不按端口隔离。
- **跨标签页：** 浏览器同一 Cookie scope 的标签页会共享 HTTP Cookie jar；插件 client 对 `set-active` 只触发调用它的 client 的 `$sessionSignal`，该 signal 会在该客户端内重取 session。Better Auth 另有 localStorage `storage` event 广播，但核心 fetch listener 明确只对 sign-out 与 update-user/update-session 广播；`multi-session/set-active` 没有广播 callback。因此不可依赖插件自动让其他已打开标签页同步重取 session。其他 tab 的 Cookie 在后续请求时会按新主 session 发送；其本地 React/query 状态何时刷新取决于客户端自身的重取时机。源码：已安装 `dist/plugins/multi-session/client.mjs`、`dist/client/config.mjs`、`dist/client/session-refresh.mjs`、`dist/client/broadcast-channel.mjs`，版本均为 `better-auth@1.7.5`。
- **缓存与撤销：** 项目当前 session 配置明确设 `storeSessionInDatabase: true`，未见显式 `cookieCache` 配置。若以后打开 session cookie cache，Better Auth 文档提醒被撤销 session 的缓存数据可能在缓存过期前仍被其他请求接受；插件删除数据库 session 不等于能立即清理其他请求已持有的缓存 Cookie。应以届时实际配置重新评估；官方 session-management 文档解释了 cache 与撤销延迟。[官方 Session Management 文档](https://better-auth.com/docs/concepts/session-management)。

## 结论边界

1.7.5 的服务端插件与 client plugin API 均已在锁定包中；服务端插件自身不带 schema 变更。它实现的是同一 Cookie scope 下账号 session 的保留、查看、切换、撤销和该浏览器范围 sign-out；不是面向用户全设备的 session 管理能力。`maximumSessions` 的计数语义与文档简写存在差异，超限仍可建立主 session，也不会保证该新身份成为可切换列表项。切换 session 会改变身份上下文，因此组织授权必须继续由切换后的 session 驱动。tenant 与 platform 的本次接入及本地验收见下文。

## 本次接入与交付约束

- 共用服务端注册 `multiSession()`，放在 `twoFactor()` 之后；共用浏览器客户端注册 `multiSessionClient()`。保持锁定版本 1.7.5，不增加迁移。
- 两端用户菜单提供账号列表、添加账号、切换账号、退出当前账号与退出全部账号。无组织入口、登录页、MFA 页和平台拒绝页也能访问已保存账号。
- `/add-account` 复用现有认证表单；邮箱登录完成后进入后台入口，GitHub 添加账号的成功回跳也指向入口。租户增加原生 TOTP 挑战页，以处理已在平台启用 MFA 的账号。
- 切换账号后重新进入后台入口，重建组织、权限和路由上下文；原有单会话退出入口使用原生 `multiSession.revoke` 并刷新会话，保持页面语言。全部退出使用原生 `signOut()`。
- 账号操作锁由菜单外的持久组件持有，添加账号和 TOTP 表单与切换菜单共享提交状态；请求期间不能发起竞争的账号操作。
- 用户已确认：启用前的登录需要重新登录一次，不迁移旧单会话 Cookie。保留插件默认上限及原生 Cookie 行为；不增加跨标签页广播或自定义会话存储。

## 本地验收（2026-10-16）

| 验证                                                                                                                                                           | 结果                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `pnpm lint`，含依赖边界                                                                                                                                        | 通过                                                                 |
| `pnpm typecheck`                                                                                                                                               | 24 个任务通过                                                        |
| `pnpm i18n:check`                                                                                                                                              | 中文、英文、阿拉伯语通过                                             |
| `pnpm exec turbo build --filter=api --filter=tenant --filter=platform`                                                                                         | API 与两端构建通过                                                   |
| `pnpm db:check`                                                                                                                                                | 通过，未产生插件 Schema 增量                                         |
| `pnpm --filter docs check:content`                                                                                                                             | 38 页内容检查通过                                                    |
| `pnpm exec vitest run --config vitest.config.e2e.mjs tests/e2e/auth.test.mjs tests/e2e/platform-mfa.test.mjs tests/e2e/multi-session.test.mjs`                 | 3 个文件、28 个真实浏览器测试通过                                    |
| `pnpm --filter storybook exec vitest run --config vitest.config.ts src/device-sessions.stories.tsx src/nav-user.stories.tsx src/personal-security.stories.tsx` | 3 个文件、15 个组件测试通过，包含键盘、失败重试、操作锁、RTL 与 a11y |

真实浏览器验证使用仓库现有 `startBrowserApplication()`，启动临时 PostgreSQL、Redis、真实 API 与两个构建产物预览。本机没有运行中的 API/后台服务；测试不会操作个人开发库。新增验收覆盖添加/取消、组织隔离、账号切换、无目标 Cookie 的切换拒绝、不可信 Origin 拒绝、当前退出保留其他账号、全部退出撤销全部已保存会话、MFA 尚未完成时不保存临时会话、平台拒绝页切回授权账号。

GitHub 只验证真实认证端点能够发起授权以及添加账号的 callbackURL 参数；第三方授权页面由测试探针截获，未完成真实 GitHub 账号授权。多标签页即时同步、超过原生默认上限的产品行为不在本轮验收内。未执行完整 `pnpm verify`，未提交、推送或部署。

界面证据：`test-results/multi-session/tenant-accounts.png`、`test-results/multi-session/platform-accounts.png`。
