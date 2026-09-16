# S6：共享 UI、Storybook、MSW 与 i18n 验收

日期：2026-09-16。范围为 [实施计划 S6](implementation-plan.md#s6并行建设-uistorybookmsw-与-i18n)。在已有 UI、DataTable、认证和 S5 列表契约上实施；工作区开始时干净，未提交或推送。

## 交付与边界

| 任务  | 实现与证据                                                                                                                                                                         |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S6-01 | 复用 `packages/ui` 已有 base-maia primitives 和 CSS tokens。Button/Input/Select/Dialog/Table/Skeleton/Popover/DirectionProvider 已由组合组件消费；没有复制或修改 shadcn 原始组件。 |
| S6-02 | `packages/admin` 增加 AppShell、PageHeader、TenantSwitcher、LocaleSwitcher、PermissionGate、FilterBar、受控 Pagination、FormDialog 和四类状态组件；复用 DataTable。                |
| S6-03 | ResourceList 通过 Projects List 用例形成；FormDialog 通过 TanStack Form + Zod 验证草稿与提交生命周期。ResourceCreate/Edit/Show 随 S7 的具体业务操作补齐。                          |
| S6-04 | Storybook 使用现有 React/Vite + Vitest Chromium + interaction + a11y；共享 preview 把 a11y 错误设为失败。                                                                          |
| S6-05 | `packages/mocks` 统一两个组织的三语言数据、List Contract handler 和七种场景。生成客户端实际发起请求，由 MSW 响应。                                                                 |
| S6-06 | `zh-CN/en-US/ar`；common/auth/organization/projects/validation 五个 UI namespace，另有稳定服务端错误码的 errors。两个 SPA 接入独立浏览器实例。                                     |
| S6-07 | i18next 订阅同步 html.lang/dir，Base UI DirectionProvider 同步 Portal/键盘方向；新布局使用 logical properties，DataTable 分页图标和列宽调整支持 RTL。                              |
| S6-08 | Intl 包装数字、百分比、货币、日期、相对时间；调用者明确提供币种与时区。                                                                                                            |
| S6-09 | Projects List 和 FormDialog 各有 Default/Loading/Empty/Error/PermissionDenied/LongText/RTL；列表另有慢网络、语言与租户切换 Story。                                                 |
| S6-10 | `pnpm i18n:check` 加入 `verify`，由既有 CI verify 步骤执行。失败条件与负例见下文。                                                                                                 |

### 状态与职责

- i18next 是 UI locale 的唯一事实来源；后台 URL 和 Router search 中不保存语言。语言切换保留当前表单草稿。
- 共享组件不持有业务查询。Storybook 的演示宿主持有查询条件，S7 正式页面由 Router 接管；DataTable 受控分页，不在组件内再保存一份。
- 生成 Query options 的 organizationId、locale 同时用于 key 和请求 Header；Storybook 每个场景使用独立 QueryClient，避免成功缓存遮蔽错误场景。
- PermissionGate 只控制展示，MSW 403 场景不构成真实授权验收。
- FormDialog 的 pending 锁定字段和关闭入口；验证失败不提交，模拟提交失败保留草稿，成功后由调用方 reset 并关闭。示例提交不写数据库。
- 认证、组织页面与编辑器工具栏的公共文案均进入翻译目录。租户名称、项目名称等内容直接使用数据，不当作系统翻译键。

## 实际验证

使用 Node **26.8.2**、pnpm **12.4.1**。测试过程中未使用本地生产数据；需要数据库的回归通过现有测试创建临时 PostgreSQL 容器。

| 命令 / 检查            | 结果                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| `pnpm peers check`     | 通过                                                                                      |
| `pnpm lint`            | 边界检查和 12 个 lint 任务通过                                                            |
| `pnpm typecheck`       | 15 个任务通过，含构建前置任务                                                             |
| `pnpm i18n:check`      | 通过；提取到 134 个 UI 键，英文和阿拉伯语均完整；另检查 errors 有限动态键及六个 namespace |
| `pnpm test:unit`       | 24 个公共单元用例、4 个 API 单元用例通过；其中新增 4 个 i18n 用例和 6 个 MSW 用例         |
| `pnpm test:storybook`  | 5 个文件、26 个 Story 测试通过，含 interaction 与 a11y                                    |
| `pnpm test:e2e`        | 8 个真实浏览器用例通过：原有 7 个认证/组织流程及新增语言切换流程                          |
| `pnpm test:api`        | Nest HTTP 10 个用例、SDK → HTTP → 临时数据库 6 个用例通过；覆盖原有并发语言与错误码规则   |
| `pnpm build`           | 7 个构建任务通过，含 Admin、Platform、API 和 Storybook                                    |
| `pnpm build:storybook` | 独立静态构建通过                                                                          |
| 静态工作台浏览器检查   | 1360px RTL/长文本、390px 列表/弹窗、窄屏导航切组织通过；无页面 JavaScript 错误            |

浏览器断言包含：表单空白名称校验、提交期间禁用、失败保留草稿、成功 reset；MSW 请求后的筛选/翻页/错误状态；切语言与租户后读取对应新数据；RTL 侧栏在右侧、Popover 可见、列宽左键增加、下一页图标方向与交互；真实登录页切语言保持 URL 和邮箱草稿，html 方向同步。

本地截图位于 `test-results/s6/`：`projects-long-text.png`、`projects-rtl.png`、`projects-mobile.png`、`form-mobile.png`、`login-rtl.png`。这些是忽略提交的本机验收产物。

## 翻译门禁失败条件

| 门禁                   | 失败条件                                         | 负例实测                 |
| ---------------------- | ------------------------------------------------ | ------------------------ |
| i18next CLI lint       | JSX 公共文案硬编码、翻译插值或拼接错误           | 注入硬编码 JSX，exit 1   |
| extract --ci --dry-run | 源码提取结果与翻译目录不一致                     | 添加未提取的 key，exit 1 |
| types --ci             | 生成类型与目录不一致                             | 改动生成资源类型，exit 1 |
| status                 | 使用的 key 缺少翻译                              | 删除英文 save，exit 1    |
| check-catalogs.mjs     | namespace/key 集合不一致、空译文或插值参数不一致 | 中文 save 置空，exit 1   |

上述负例在临时副本运行，未污染当前源码。生成物通过 CLI 更新；types 检查模式和 extract dry-run 不改写 CI 工作区。

## 验收限制

- S6 完成组件与基础设施验收；Projects 正式 Router 页面及 Create/Edit/Show/Delete 的持久化闭环仍属 S7。S5 Update 字段待确认的状态未改动。
- 用户 preferredLocale、组织 defaultLocale 的设置/持久化流程仍属 S8；本次未增加浏览器存储或 URL 语言状态。
- 未运行整个 `pnpm verify`；本次未修改迁移/RLS/Compose，未重复数据库专用与 Compose 测试。已运行受影响的 API/数据库链路回归。
- 未推送，远端 GitHub Actions 未触发。构建仍有 chunk 体积提示，不影响构建结果。

## 实施参考

- [shadcn Base UI Direction](https://ui.shadcn.com/docs/components/base/direction)
- [Storybook 网络 Mock](https://storybook.js.org/docs/writing-stories/mocking-data-and-modules/mocking-network-requests)
- [i18next CLI](https://github.com/i18next/i18next-cli)
