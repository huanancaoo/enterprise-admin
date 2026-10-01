# S8 平台用户目录与敏感读取验收

日期：2026-10-01。对应 [Issue #21](https://github.com/huanancaoo/enterprise-admin/issues/21)。

## 实现与边界

平台 Users 提供只读目录和详情。列表按创建时间、用户 ID 稳定分页，支持姓名、用户 ID 和脱敏邮箱检索；默认 20 条，最大 100 条。详情只展示组织关联、邮箱验证和双重验证状态，不增加账号修改、封禁或他人会话管理。

列表与详情对两个平台角色统一脱敏。完整邮箱仅通过独立 sensitive-profile 请求读取，要求有效平台管理员和当前 Session MFA，并携带 1–500 字符的读取目的。函数先成功追加一条私有访问审计才返回结果，审计失败返回 503，不返回已查询的身份投影。审计记录目标用户 ID，不存邮箱快照。

遵循用户于 2026-09-28 确认的共用连接池决定，API 使用 app_runtime，平台模块只执行固定函数。NOLOGIN platform_executor 仅获得必要身份列权限，不获得密码、Session token、2FA secret 和恢复码的读取权限；历史 platform_runtime 不获得新函数执行权限。认证运行身份的既有认证职责不变。

前端使用共享 Contract 与 Orval 客户端。普通目录的 Query Cache 只保存脱敏投影；完整邮箱只在本次展开的组件状态中保存，关闭后销毁。角色降为审计员后再次读取被拒绝，重新取得平台访问状态并移除敏感展开。无效提交恢复编辑，失败保留目的，三种语言的校验和关闭操作均已本地化。

## 本次实际验证

| 验证                                                              | 结果与证据                                                                                                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm lint`、`pnpm typecheck`                                     | 工作区检查通过；最终只读按钮样式修改另经平台文件 ESLint 和生产构建验证                                                                                                   |
| `pnpm i18n:check`                                                 | 443 个键，zh-CN/en-US/ar 完整，无资源或类型漂移                                                                                                                          |
| `pnpm api:check`                                                  | OpenAPI 与 Orval 生成物可复现                                                                                                                                            |
| `pnpm db:check`                                                   | Better Auth Schema 无生成漂移                                                                                                                                            |
| `pnpm test:database`                                              | 18 项真实数据库测试通过，新迁移和重复迁移仍通过                                                                                                                          |
| API：`platform-users.test.mjs`、`platform-organizations.test.mjs` | 19 项通过，其中 #21 新增 7 项；生成 SDK → HTTP → 真实数据库，覆盖脱敏、分页、关联投影、敏感权限、目的校验、审计故障、撤权、固定函数权限、认证秘密列权限和租户业务隔离    |
| 浏览器：`platform-users.test.mjs`                                 | 7 项通过；真实构建产物 → API → 数据库，覆盖检索分页、详情、显式敏感读取、草稿保留、关闭清理、审计员网络及 DOM 脱敏、降权、加载/错误/重试/空状态、三语言、RTL、键盘和 Axe |
| 本地开发数据库                                                    | one-shot migrator 成功应用 0031；不是生产部署                                                                                                                            |

HTTP 和浏览器使用既有 Testcontainers、Vitest 和 Playwright 入口。OrbStack 的 Docker 端点需显式配置 `DOCKER_HOST=unix:///Users/huanancao/.orbstack/run/docker.sock`；Chromium 在本机 macOS 沙箱外运行。

可复现界面截图保存在 `/private/tmp/enterprise-admin-issue21-en.png`、`/private/tmp/enterprise-admin-issue21-zh-CN.png` 和 `/private/tmp/enterprise-admin-issue21-ar.png`，均为测试身份数据。

## 尚不属于本任务的验收

本次没有执行生产发布或推送，也没有将上述验证称为 S8 全量验收。跨组织平台审计属于 #22，平台设置属于 #23，组合流程、发布门禁和规定数据规模下的性能验收属于 #24。
