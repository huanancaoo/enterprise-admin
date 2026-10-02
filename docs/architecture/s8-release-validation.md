# S8 跨功能与发布验收记录

日期：2026-10-02。对应 [#24](https://github.com/huanancaoo/enterprise-admin/issues/24)。本记录确认迁移安全、固定规模 HTTP 性能及下文列出的组合浏览器、授权补充和完整本机检查。[T01–T28 矩阵](s8-acceptance-matrix.md) 逐项列出证据及边界。安全回退、ADR/CLI 一致性和关键 Feature 展示覆盖仍未完成，#24 与父任务 #8 继续保持开放。

## 迁移安全

`packages/database/src/migrate.ts` 使用真实 `app_migrator` 连接，在同一个连接持有 advisory lock 至 one-shot 结束；后到的进程取锁后重新读取 ledger。首次引入 S8 组织约束前检查无 owner、重复成员关系、同组织重复角色，异常显式停止，不改写旧数据。SQL 及 ledger 仍由 Drizzle 事务提交，API 启动不执行迁移。

真实 PostgreSQL 回归 `pnpm test:database`：2 文件、23 项通过，原 `isolation.test.ts` 断言未修改。新增证据：

- 两个进程在同一空库并发运行，只记录一份完整迁移历史，两者都成功退出。测试只在临时 SQL 副本增加延迟，不修改迁移历史。
- S7 迁移至当前链并重复执行，成员、角色、邀请、个人/组织语言保留；原 `enabled=false` 保留为 `SUSPENDED`，不隐式授予平台任职。
- 无 owner、重复成员、重复角色分别阻止升级，原数据与 ledger 保持原状。

原实现曾实际出现双 Migrator 一个失败、无 owner 组织升级成功，两项均已由真实迁移进程复现后修正。Compose 复核使用测试专属项目、随机凭据和数据卷，验证独立镜像迁移、卷重建持久化、重复迁移、错误运行身份的非零退出。它不表示 API/SPA 生产部署或安全回退门禁已完成。

## 固定规模性能

入口：`pnpm test:performance`，同一 Vitest 配置的独立串行 project。API 使用当前生产构建、迁移及 `app_runtime`；平台管理员通过真实 HTTP 启用并验证 TOTP。未关闭审计、RLS、角色检查或 Redis 限流，也未增加 runtime 权限。

测试库在计量前精确为 100 个组织、10000 用户、100000 条审计。100 个 owner 独立创建组织，9899 名普通成员通过真实原生成员管理加入组织，另有 1 名平台管理员；遵守每组织 100 人上限。历史审计通过 TenantTx 与 `app_runtime` 写入，并分布于前 89 天。生产迁移身份只创建测试用户数据，bootstrap 只核对全局事实与执行计划。造数不属于注册/邮箱验证业务闭环证据。

每端点 20 次预热，随后 20 并发客户端各执行 10 次请求，共 200 样本；客户端 IP 在本轮固定。计时从发起 HTTP 至读完 JSON 响应，校验响应状态和数据数量；四个业务端点使用正式 Schema，原生成员列表核对总人数及页内成员数。P95 取排序后的第 190 个样本；测量为第一页、每页 20 项、预热缓存，不声明所有筛选和深分页的最坏时延。

本机实际结果：

| 端点             | P50（ms） | P95（ms） | 最大（ms） | P95 门槛（ms） |
| ---------------- | --------- | --------- | ---------- | -------------- |
| 平台组织列表     | 18.64     | 26.84     | 36.48      | <500           |
| 平台用户列表     | 79.51     | 98.51     | 118.24     | <500           |
| 原生组织成员列表 | 32.33     | 37.37     | 42.57      | <500           |
| 租户审计，90 天  | 31.26     | 35.05     | 36.34      | <1000          |
| 平台审计，90 天  | 66.03     | 82.53     | 94.65      | <1000          |

环境：macOS/arm64、Apple M2 Pro（10 核）、32 GiB 主机内存、Node 26.8.2；容器 PostgreSQL 18.6/aarch64，shared_buffers=128MB，max_connections=100；数据库 cgroup 未另设内存/CPU 上限，runtime Pool max=10。外部 SMTP 未运行也未计时，测试期间无其他 API/浏览器验收负载；完整性能入口 2 项通过，约 42 秒，包含造数。

计量结束审计为 100660 条，组织和用户数不变。受限平台读取仍各自追加成功审计，没有人为冻结审计数来降低负载。

## 实际发现与修正

原平台审计列表在相同规模下 P95 为 3753.20ms，超过 1000ms。原投影查询执行计划实际扫描/关联 89901 条运营事实，生成全部 JSON 后才排序取 21 条，单次诊断查询约 664ms。

新增 reviewed migration `0037_platform-audit-pagination.sql`：两个来源分别先限制候选数量，合并确定最终页后才关联身份并生成固定脱敏投影。仅改查询顺序，没有扩大事件目录、角色权限、RLS、返回字段、最大时间窗口或性能门槛。

真实 API 回归 `tests/api/platform-audit.test.mjs` 8 项通过：保留原权限/撤权、固定窗口、投影脱敏、审计故障与共享 Pool 隔离测试；新增同一时间戳的两类来源跨页、组织/actor/result 筛选、列表与详情一致性及内部理由不泄露。查询失败时仍不返回受限数据。

## 组合浏览器验收

`tests/e2e/s8-integration.test.mjs` 使用生产构建 SPA、真实 API/PostgreSQL、Redis、Mailpit 与邮件 Worker，6 项通过：

- 组织访问、无组织账号个人偏好分别延后真实 HTTP 响应；用户先在页面选阿语，响应返回后仍保持阿语与 RTL。原组织场景已稳定复现迟到响应把阿语改回中文；修正登记继承基线，初始化期间的显式手选优先。
- 所有者从成员页面发邀请；新收件人从公开页面注册，访问真实 SMTP 邮件中的验证链接，再登录接受邀请。通过正式页面分配自定义角色、成功编辑项目、收回编辑权限；撤权前已打开的草稿下一次提交得到 403，原描述不变。引用阻止删除角色；移除成员的原生 HTTP 成功后旧 Cookie 请求得到 403，页面清掉项目内容；解除引用后删除角色成功。收件人未以 SQL 直接置已验证。
- 同一浏览器上下文两个标签停留不同组织，共享 Session 的 activeOrganization 改成 B 后，A 标签仍按 URL 读写 A；列表与 HTTP 持久化事实分别核对。B 退出后历史返回和 A 标签均回登录，旧缓存不展示，HTTP 返回 401。
- 权限读取的 429 展示可重试读取错误，成功重试真实服务端后恢复角色页面。此项使用浏览器响应拦截验证异常展示，不作为授权验收。
- 平台任职由真实部署 CLI 授予；平台页面完成登录、TOTP 启用和验证码验证后才展示运营导航。页面停用组织后旧租户会话 HTTP 403 且刷新页面清掉项目；页面恢复后同一会话 HTTP 200，项目仍可见。租户审计页面显示两次平台状态事件，列表响应和详情不含内部原因。

连续流程另实际发现权限请求扇出：角色页面每次分别请求 17 个原生权限判断，完整操作在限流窗口中触发 `has-permission` 的 429，角色页面错误显示无权访问并卸载操作弹层。正式修正使用固定的 `role-access` 读取，将判断合并为一个 HTTP 请求，内部仍调用原生授权。完整流程未关闭或提高原生限流，未插入等待跨过限流窗口。

`tests/api/organization-role-access.test.mjs` 4 项真实 HTTP 验证通过：固定 Schema 与 no-store、owner/admin/member/动态角色的实际权限、匿名/跨组织拒绝、同一 Cookie 动态撤权和成员移除、组织停用拒绝。普通 member 原本具有 `ac:read`，其写动作仍为 false；结果不由前端角色名称推断。

完整浏览器回归曾在个人语言设置的键盘选择处失败。延迟测试浏览器动画帧 150ms 后稳定复现：End 和第二个 Enter 仍发送到触发按钮，而非选项。该用例补充打开后的继承选项焦点、End 后的阿语选项焦点断言；同一延迟条件下通过。产品未增加等待或特殊分支，临时帧调度及日志已移除。平台事件详情验收等待真实详情 HTTP 200 和页面完成加载，再核对响应与弹层均不含内部原因。

截图位于测试输出 `/private/tmp/enterprise-admin-s8-manual-organization-ar.png`、`enterprise-admin-s8-manual-account-ar.png`、`enterprise-admin-s8-role-reference.png` 与 `enterprise-admin-s8-tenant-platform-projection.png`，均为专属测试数据，不含 TOTP URI 或凭据。

## 授权补充与存在性差异修正

新增 `tests/api/s8-authorization.test.mjs`：直接用真实 Cookie 核对跨组织与随机不存在 ID/slug 的同等拒绝，成员/角色/邀请 ID 的拒绝和不变事实，同名角色在 A/B 的权限及分配独立，错误/未验证邮箱的既有 Session 不接受邀请，停用后的完整原生入口目录，以及 auth 写缺 Origin/非法 Origin 的拒绝。T17 通过公开资料写入 platform_admin 名称和提交 role/metadata 后，五个实际平台读入口仍拒绝、任职表仍无记录。

T01 首次真实复现了存在性差异：已存在的外部组织返回 403，不存在的组织返回 400。此前 before hook 发现非成员后直接交给原生处理器，而原生先查组织再查成员。修正将未授权目标统一在前置成员检查拒绝；显式 slug 未匹配也使用同一拒绝。测试比较状态码及完整响应体，原生生命周期仍由 Better Auth 执行，没有放宽原先隔离断言。

T15 还实际复现了空参数绕过：停用组织已经是当前 Session 的 activeOrganization 时，`get-organization?organizationId=` 仍返回 200。原生普通组织入口以 truthy 规则选择当前组织，原解析器却使用 nullish 规则而跳过状态检查。修正区分普通入口与原生动态角色入口的两类规则，事务内的邀请、成员、角色准备也复用同一解析器。回归核对空参数的受保护读/写拒绝、动态角色空 ID 仍为原生 400，以及 organizationId=null 携带 slug 时仍按原生语义清空当前组织。

`platform-audit.test.mjs` 新增强制单连接的 T24：占住 Pool 其余连接，真实平台停用和审计查询与 A/B 并发 HTTP 必然复用唯一剩余连接。8 轮核对各自项目、同一 PID 与事务外无组织上下文；被停用组织的成员仍收到 403。原跨组织读取与数据库隔离测试保留。`packages/database/test/isolation.test.ts` 新增 app.is_platform 伪造、空平台任职结果、SET ROLE/私有任职表拒绝及事务后标记清理，不修改原 8 项断言。

`platform-assignment.test.mjs` 新增生产配置的可信设备密码登录和 GitHub callback 测试：先真实 TOTP 取得有效平台 Session，退出后通过相应入口建立新的真实 Session；其 twoFactorEnabled 仍为 true，但没有当前 Session assurance，平台返回 PLATFORM_MFA_REQUIRED。GitHub 仅三个提供者响应为 fixture，state、callback、Cookie、Session 和守卫不替换；不宣称外部 GitHub 服务登录通过。

`tests/e2e/platform-mfa.test.mjs` 验证真实 owner/admin 的拒绝页面；伪造 localStorage 中的任职/user 后重新进入受保护路由，HTTP 403、无运营导航、数据库无任职。独立测试用户各自使用固定测试 IP，同一个 MFA 流程内地址不变，生产登录限流保留。

首次聚焦检查：补充授权与平台审计共 15 项 HTTP 通过，可信设备/社交 callback 两项生产 HTTP 通过，数据库隔离 9 项通过，平台浏览器 3 项通过。随后新增空参数回归及修正，7 项原生授权回归通过；最新生产代码的完整检查结果见下文。

## SMTP unknown 页面与提交期间禁用

`tests/setup/smtp-ambiguity.mjs` 提供 API 与浏览器共用的真实 TCP SMTP 场景：客户端传完 DATA 后断开连接，不返回最终确认，不直接布置投递状态。`tests/e2e/invitations.test.mjs` 经正式成员页面提交邀请，核对 HTTP 200、弹层关闭、创建成功但结果未知的提示、唯一 pending 邀请及已完成的 unknown 投递记录；SMTP 端确认只收到一次完整数据。刷新后仍显示 unknown，再通过正式用户菜单验证 zh-CN/en-US/ar 与阿语 RTL。它不声称邮件到达收件箱。截图为 `/private/tmp/enterprise-admin-s8-invitation-unknown-ar.png`。

第一次完整浏览器回归出现组织创建/切换和阿语重复角色反馈两项失败。独立场景随后通过，不能将其当作修复证明；通过暂缓真实角色响应及 MSW 组织目录读回，分别稳定复现了提交期间文本框仍可编辑、切换器只有禁用标记但实际按钮未禁用的缺口。

角色创建区域改用 TanStack Form 的完整提交状态，禁用持续覆盖列表读回与表单重置，防止后续输入被迟到重置清除。SidebarMenuButton 先将原生属性应用于实际按钮，再挂载 Tooltip，保留按钮 id/disabled；Tooltip 的 disabled 只控制提示交互。布局 Story 验证切换后的目录读回未结束时按钮真实禁用，并等待菜单完成关闭后执行原有 axe 检查。新的真实角色用例保留键盘提交、错误反馈和草稿断言，额外验证请求暂缓期间字段禁用及完成后的重置。

聚焦证据：邀请 API 17 项、邀请浏览器 3 项、后台布局 Story 3 项通过；新生产构建的组织切换、阿语角色创建及三语 unknown 页面共 3 个聚焦场景通过。本批完整结果见下节，不由聚焦结果推导全套通过。

该轮完整检查在浏览器阶段还有一次个人语言设置失败：从组织设置进入个人设置后，已打开的阿语选项被卸载。暂停真实当前组织响应，再暂停随后访问查询，稳定复现了选项消失且布局只剩加载状态；语言仍为英语，排除了语言切换本身触发卸载。组织原生创建/切换已改变 Session，但客户端只刷新组织目录、没有同步当前组织缓存；布局又把未读回的组织当成无组织，先显示表单后将其卸载。

现在在原生写入成功后同步当前组织缓存，布局首次查询未完成时等待组织上下文，避免开放随后会被访问检查卸载的表单。正式语言设置用例暂缓真实组织响应，核对响应到达后选项仍保留并实际选择、保存阿语，继续执行原有继承、组织切换和陈旧版本草稿断言。访问请求只在个人设置的当前组织请求已发出后暂停，清理时不再误释放前一页面已取消的请求。最终语言设置文件 4 项浏览器测试通过且进程退出码 0。

## SMTP 与界面时序批次完整检查

本批修正后的生产代码通过完整 `pnpm verify`，进程退出码为 0：155 项真实 API（15 项 Nest HTTP、140 项业务 HTTP）、75 项浏览器、98 项 Storybook、24 项数据库、2 项固定规模性能全部通过。peer、lint/工程边界、typecheck、i18n、38 页文档内容检查、单元测试、数据库 Schema、生产构建及 OpenAPI/Orval 可重现检查均通过。

完整日志为 `/private/tmp/enterprise-admin-s8-smtp-ui-verify-final.log`。稳定的按钮禁用、角色提交和语言选项失败分别记在 `enterprise-admin-s8-switcher-disabled-red.log`、`enterprise-admin-s8-role-pending-red.log`、`enterprise-admin-s8-locale-select-red.log`；它们与最终完整检查分开记录，均位于 `/private/tmp`。测试使用自有容器，本记录不表示已向个人开发库应用迁移或完成实际发布。

## 授权批次完整检查

本批生产代码已通过完整 `pnpm verify`，进程退出码为 0：peer、lint/工程边界、typecheck、i18n、单元测试、真实 API HTTP、固定规模性能、Storybook、浏览器业务、数据库 Schema/隔离、生产构建及 OpenAPI/Orval 可重现检查全部通过。

- API：Nest HTTP 15 项，业务 HTTP 140 项，共 155 项。
- 浏览器：11 文件、74 项；Storybook：13 文件、97 项；数据库：2 文件、24 项；性能：1 文件、2 项。
- 文档站内容检查覆盖 38 页；本次架构 Markdown 另进行定向 Prettier 检查，不由文档站页数推导其检查范围。

完整检查之后只补充了 T01 的 Body 组织目标替换断言，生产代码未改；同一生产构建上的 `s8-authorization.test.mjs` 7 项再次通过。日志分别保存在 `/private/tmp/enterprise-admin-s8-authorization-verify-final.log` 与 `/private/tmp/enterprise-admin-s8-authorization-final-assertions.log`。

## 平台组织 Feature Stories

`apps/platform/src/features/organizations/pages.stories.tsx` 通过内存路由运行正式组织列表、详情、拒绝访问和登录页面，26 个场景覆盖默认、加载、空列表/空状态历史、错误、权限拒绝、401、404、长文本、RTL、慢请求、只读任职、筛选/排序/分页和危险确认。危险确认实际驱动原因与 slug 校验、键盘停用/恢复、提交期间禁用、关闭后的焦点恢复；409 保留输入并要求复核新版本，目标状态已达到时读回 no_change；429 保留输入供手动重试；近期 MFA 场景驱动正式验证码界面。各场景重置自有 MSW 状态，目录和详情从同一状态读回，避免前一 Story 的写入污染后续场景。

本批没有修改生产页面、API、契约或认证实现。MSW 模拟身份、平台任职和验证码结果，只证明 UI 状态与交互；真实认证、授权、MFA、数据库和发布仍以各自真实链路证据为准。各状态先等待正式内容出现再执行 Storybook 内置无障碍检查，避免长文本或 RTL 只检查到加载态。

本批相关检查均退出码 0：全量 Storybook 14 文件、124 项（含新增 26 项）；单元测试根目录 43 项、API 28 项、文档站 3 项，共 74 项；工作区 lint 和类型检查各 16 个任务；Storybook 构建 3 个任务。本批未重跑 API HTTP、真实浏览器业务、数据库、性能或完整 `pnpm verify`，上文完整检查属于对应历史批次。

日志位于 `/private/tmp/enterprise-admin-s8-organizations-stories-regression.log`、`enterprise-admin-s8-organizations-stories-unit.log`、`enterprise-admin-s8-organizations-stories-lint.log`、`enterprise-admin-s8-organizations-stories-typecheck.log` 和 `enterprise-admin-s8-organizations-stories-build.log`。另用已构建的工作台在 1280×1000 视口核对长文本列表、详情与 RTL 确认框：列表/详情的页面 scrollWidth 均为 1280，阿语页面方向为 rtl、slug 输入为 ltr，无浏览器 pageerror；截图为 `/private/tmp/enterprise-admin-s8-organizations-long-text.png`、`enterprise-admin-s8-organizations-detail-long-text.png` 与 `enterprise-admin-s8-organizations-rtl.png`。这些都是 UI fixture，不是新增的真实后台业务验收。

## 平台用户与审计 Feature Stories

新增用户目录/详情 28 个场景和平台审计 25 个场景，通过内存路由运行正式页面。目录、详情、拒绝访问和会话失效均使用各自正式内容，列表查询、表单校验和异常跳转没有替换。MSW fixture 按契约解析查询，筛选/分页确实改变读回结果；用户详情只返回脱敏邮箱，完整邮箱仅在显式敏感读取响应中出现。审计记录使用相对时间进入默认 30 天窗口，详情与列表引用同一事件，每个 Story 重置重试状态。

用户场景覆盖默认、加载、空目录/无成员关系、错误、401/403、404、长文本、三语/RTL、慢请求、未验证用户、只读任职和筛选/分页。敏感读取覆盖目的校验、提交期间字段/按钮禁用、503/429 保留目的并手动重试、键盘提交与焦点恢复；关闭后完整邮箱离开 DOM，重开后目的和邮箱均清空。审计场景覆盖相应列表/详情状态、尚未填写读取目的、重试恢复、任职事件投影、筛选/游标分页以及目的、组织 ID 和日期校验；详情 401/403 后列表和弹层均清除。

这批实际发现三类无障碍缺口：无效 Field 的错误色被输入值继承，在输入背景上对比度为 4.45，未达到 4.5；只读成员表的长文本溢出缺少可聚焦目标；用户详情及审计弹层的 404 内容创建了嵌套主地标。Input/Textarea 明确使用正文色，错误边框和反馈保留；只读表格增加键盘焦点与翻译后的名称；独立 404 页面创建主地标，详情和弹层复用不创建主地标的内容。未改变 API、认证、授权、契约或业务异常规则。

校验场景保持错误表单可见，再执行工作台内置 axe，组织危险确认也保留错误态接受检查。测试准备阶段等待审计弹层实际可见；详情失权场景直接等待拒绝/登录页，避免等待已经卸载的弹层。此前敏感弹层关闭失败没有稳定证明产品缺陷：原生浏览器核对退出动画和 DOM 移除，相关关闭与焦点断言仍保留，没有为此增加产品分支。

聚焦最终检查退出码 0：组织 26、用户 28、审计 25 个场景，共 79 项通过。原生浏览器对长文本成员表核对焦点和 ArrowRight 的默认滚动：scrollLeft 从 0 变为 3，表格 scrollWidth=4851、clientWidth=1104，1280 像素视口的页面 scrollWidth=1280。该键盘证据与 Story 中的焦点和 axe 检查分别记录，不以合成键盘事件推导浏览器默认滚动。

聚焦日志为 `/private/tmp/enterprise-admin-s8-read-pages-and-danger-green.log`；首次失败、最小失败、只读表格焦点失败和错误态对比度失败分别见同目录的 `enterprise-admin-s8-users-audit-stories-first.log`、`enterprise-admin-s8-users-audit-minimal-red.log`、`enterprise-admin-s8-membership-scroll-red.log`、`enterprise-admin-s8-sensitive-error-state-red.log` 与 `enterprise-admin-s8-danger-error-contrast-red.log`。长文本键盘截图为 `/private/tmp/enterprise-admin-s8-users-long-text-keyboard.png`。身份与任职仍为 UI fixture，这些新增场景不证明真实登录、MFA、RLS、邮件或发布。

## 用户与审计批次完整检查

最终源码通过完整 `pnpm verify`，进程退出码为 0：API 155 项（Nest HTTP 15、业务 HTTP 140），浏览器 11 文件/75 项，Storybook 16 文件/177 项，数据库 2 文件/24 项，固定规模性能 1 文件/2 项全部通过。单元测试根目录 43、API 28、文档站 3 项，共 74 项通过；peer、lint/工程边界、typecheck、i18n、38 页文档内容、数据库 Schema、生产构建及 OpenAPI/Orval 可重现检查均通过。独立 Storybook 构建 3 个任务通过。

最终完整日志为 `/private/tmp/enterprise-admin-s8-users-audit-verify-final.log`，Storybook 构建日志为 `enterprise-admin-s8-users-audit-storybook-build.log`。执行前后的本批 13 个源码文件 SHA-256 一致，列表为同目录的 `enterprise-admin-s8-read-pages-source-before.txt` 和 `enterprise-admin-s8-read-pages-source-after.txt`，cmp 退出码 0。较早的 `enterprise-admin-s8-users-audit-verify.log` 只有 174 个 Storybook 场景，且早于错误态增强和 Textarea 修正；本批最终结果以上述 final 日志为准。验证使用自有容器，不表示已向个人开发库应用迁移或完成实际部署。

另核对已构建工作台的用户敏感读取 RTL 弹层、审计 RTL 详情和长文本详情，均为 1280×1000 视口，页面 scrollWidth=clientWidth=1280、无浏览器 pageerror；审计弹层自身 scrollWidth=clientWidth=448，长字段完整换行。实际截图已查看，路径为 `/private/tmp/enterprise-admin-s8-users-rtl.png`、`enterprise-admin-s8-audit-rtl.png` 和 `enterprise-admin-s8-audit-long-text.png`。审计渲染日志为同目录的 `enterprise-admin-s8-audit-render.log`；工作台自动运行详情 Story 的交互后再等待弹层内容和动画结束，避免重复操作隐藏在弹层后的筛选表单。此核对仍限于 UI fixture、当前 Chromium 和上述视口，不增加真实后台或移动端验收结论。

## 平台设置与租户审计 Feature Stories

平台设置从 13 个场景增至 21 个。默认、空 SMTP 配置、只读、加载、错误、长文本、三语/RTL 和慢请求明确等待实际内容，避免内置 axe 只检查到加载态；保存实际选择英语、键盘提交、核对字段和按钮禁用、成功读回及原因清空。另覆盖读取重试、错误原因、陈旧版本保留草稿并显式丢弃重载、429/503 保留输入供手动重试，以及保存失权、会话失效和近期 MFA 的正式页面跳转。fixture 每次重跑重置版本与失败状态，语言变更和版本读回来自同一份状态。

新增租户审计 26 个场景，通过内存路由运行正式审计 Feature。覆盖默认、加载、空、错误、权限拒绝、401/429、慢请求、重试、长文本、三语/RTL；详情覆盖加载、503/404/403/401、长文本、RTL、平台摘要和系统操作者。筛选/游标分页作用于同一批相对时间记录；无效 actor、倒置日期和超过 90 天的范围保留原列表。键盘打开与 Escape 关闭后恢复原事件按钮焦点。这里的 401/403 使用 Feature 自身的读取错误展示，不作为全应用登录跳转或授权撤销证据。

两个新增场景实际复现了租户审计缺陷：结构化长事实使弹层顶部超出视口 192 像素，RTL 关闭按钮仍使用英语 Close。审计详情改在弹层内滚动，保留原 X 关闭样式并从 common catalog 读取 Close/关闭/إغلاق；三语类型由 `i18next-cli types` 重新生成。公共 Dialog 的接口、其他调用者、审计 API 和可见投影未修改。

首次工作台回归还复现了停用组织布局场景过早读取切换器：访问拒绝已出现，但独立组织目录仍在加载。将目录响应延迟 300ms 后，最小检查稳定重现该失败；现在等待实际组织按钮再切换，原菜单关闭、另一组织加载和拒绝提示清除断言保留。审计空状态也明确等待空文案，避免把同为 status 的加载提示当成最终结果。没有增加产品等待或异常分支。

最终聚焦检查 3 文件、50 项全部通过，退出码 0：平台设置 21、租户审计 26、后台布局 3。第一次两个 Feature 检查为 44 通过、3 失败；最小失败检查为长详情、RTL 关闭标签和停用布局 3 项失败。日志为 `/private/tmp/enterprise-admin-s8-settings-tenant-audit-first.log`、`enterprise-admin-s8-audit-layout-minimal-red.log` 和 `enterprise-admin-s8-settings-tenant-audit-focused.log`。首次设置命令实际运行了全量 185 个场景，设置 21 项通过但布局 1 项失败；不能把该日志宣称为全量通过。

## 设置与租户审计批次完整检查

本批完整 `pnpm verify` 的日志记录所有检查通过，并结束于 OpenAPI/Orval 可重现检查成功：API 155 项（Nest HTTP 15、业务 HTTP 140），浏览器 11 文件/75 项，Storybook 17 文件/211 项，数据库 2 文件/24 项，固定规模性能 1 文件/2 项。单元测试根目录 43、API 28、文档站 3 项，共 74 项；peer、lint/工程边界、typecheck、i18n、38 页文档内容、数据库 Schema 和生产构建均通过。日志为 `/private/tmp/enterprise-admin-s8-settings-tenant-audit-verify-final.log`。本批净增 34 个 Storybook 场景；并未替代已有真实 HTTP、数据库或组合浏览器验证。

验证前后本批 13 个源码文件 SHA-256 一致，列表为 `/private/tmp/enterprise-admin-s8-settings-audit-source-before.txt` 和 `enterprise-admin-s8-settings-audit-source-after.txt`。手写源码和两份验收文档共 14 个文件通过定向 Prettier 检查；`resources.ts` 保留 i18next-cli 的标准生成格式，由 `types --ci` 验证可重现，不人工格式化生成文件。

核对完整检查生成的工作台产物：平台设置长部署摘要、平台设置 RTL、租户审计 RTL 详情及长详情在 1280×720 视口的页面 scrollWidth=clientWidth=1280，无浏览器 pageerror。长详情 top=16、bottom=704，clientHeight=688、scrollHeight=1284，弹层宽度及 scrollWidth 均为 448；原生 End 键使 scrollTop 从 0 到 595，Escape 后事件按钮恢复焦点。原生浏览器检查退出码 0，日志为 `/private/tmp/enterprise-admin-s8-settings-audit-render.log`。截图已查看，路径为同目录的 `enterprise-admin-s8-platform-settings-long-text.png`、`enterprise-admin-s8-platform-settings-rtl.png`、`enterprise-admin-s8-tenant-audit-rtl.png`、`enterprise-admin-s8-tenant-audit-long-text.png` 和 `enterprise-admin-s8-tenant-audit-long-text-keyboard.png`。这些证据限于 UI fixture、当前 Chromium 和上述视口，真实授权、隔离、邮件及发布仍按各自链路验收。

## 个人与组织语言 Feature Stories

新增个人 24、组织 20 个正式 Feature 场景，聚焦检查 2 文件/44 项通过，退出码 0；租户应用与 mocks 的 lint/typecheck 均通过。覆盖默认、加载、null 继承空态、错误、401/403、只读、权限查询失败、三语/RTL、慢请求、提交锁定、409 保留草稿后使用最新版本重试、429/503 手动重试、保存失权，以及清空组织默认值。语言选项只有三个受支持 locale 和 null；长文本采用实际继承文案，在 320 像素区域断言无水平溢出，不构造非法语言值。

个人设置还覆盖固定选择、组织继承、组织无默认值时的平台继承、无组织的平台继承，已保存但 access 刷新失败，以及组织目录错误和持续加载。正式组件读取 `form.state` 未形成提交状态订阅，保存期间按钮和 Select 没有按要求锁定；两个表单改用 `form.Subscribe`，保持字段和按钮同一提交状态。初始化默认值与服务端快照一致，权限查询完成后的重绘不再把已加载组织语言清为空值；原未保存草稿同步约束保留。

无组织时清空个人偏好原先固定使用 zh-CN；现在采用同次 PATCH 返回的继承语言及来源，存在组织的继承仍读取正式 access。固定个人偏好保存独立于组织目录查询；继承选择在目录未确定或失败时保留草稿并显示保存失败。原错误文案把尚未发送的写请求称为“设置已保存”，现在只在写入成功、随后刷新失败时使用该提示。

首次 42 个场景为 36 通过/6 失败；等待提交状态后的最小检查仍 6 项失败。无组织继承和尚未保存提示修复后，持续加载检查再稳定复现固定选择被静默忽略、继承提交无提示的 2 项失败；默认值最小检查为 1 失败/1 通过/18 跳过。最终 44 个场景全部通过。日志为 `/private/tmp/enterprise-admin-s8-locale-stories-first.log`、`enterprise-admin-s8-locale-minimal-red.log`、`enterprise-admin-s8-locale-pending-red.log`、`enterprise-admin-s8-locale-initialization-red.log` 和 `enterprise-admin-s8-locale-stories-final.log`。这些 UI fixture 只证明 Feature 行为，身份、全应用导航及隔离继续使用真实链路验收。

真实浏览器回归使用现有 `tests/e2e/locale-settings.test.mjs` 的数据库/API/SPA 入口：无组织用户先保存阿语并刷新，再将自有测试环境的平台默认值设为英语，清空个人偏好，核对 PATCH 200 的 null 偏好及英语继承、即时 UI、方向和再次刷新。测试结束恢复原平台默认值。修改前 HTTP 返回 en-US 而页面仍为 zh-CN，真实回归失败；首次修复后的 4 项语言浏览器回归全部通过，退出码 0，覆盖原组织切换、个人/组织设置、草稿及失权流程。对应日志为 `/private/tmp/enterprise-admin-s8-locale-no-org-red.log` 和 `enterprise-admin-s8-locale-e2e-green.log`；该 4 项结果早于后续默认值与目录持续加载修正，最终源码的完整结果另行记录。

## 语言设置批次完整检查

最终源码执行 `pnpm verify`，进程退出码 0：API 155 项（Nest 15、真实业务 HTTP 140）、浏览器 11 文件/75 项、Storybook 19 文件/255 项、数据库 2 文件/24 项、性能 2 项及单元 74 项全部通过。peer、lint/工程边界、16 个包的类型、i18n、38 页文档内容、数据库 Schema、生产构建和 OpenAPI/Orval 可重现检查全部通过。日志为 `/private/tmp/enterprise-admin-s8-locale-verify-final.log`。验证前后本批 8 个源码文件的 SHA-256 一致；最终文档与本批源码另外执行定向格式及文档内容检查。

使用完整检查生成的 Storybook 产物核对 5 个场景：个人/组织语言 RTL、个人/组织继承长文案、个人设置原生键盘保存。1280×720 视口中页面 scrollWidth=clientWidth=1280，无浏览器 pageerror；两个长文案场景的 mainWidth=mainScrollWidth=320。这是窄内容区域检查，不是 320 像素移动视口验收。原生 Enter 打开选项，End 和 Enter 选择阿语，Enter 提交后确认阿语保存状态与 RTL。浏览器进程退出码 0，日志为 `/private/tmp/enterprise-admin-s8-locale-render.log`。

5 张截图已查看，位于 `/private/tmp`：`enterprise-admin-s8-personal-locale-rtl.png`、`enterprise-admin-s8-organization-locale-rtl.png`、`enterprise-admin-s8-personal-locale-long-text.png`、`enterprise-admin-s8-organization-locale-long-text.png`、`enterprise-admin-s8-personal-locale-native-keyboard.png`。渲染与键盘证据限于正式 Feature、UI fixture、当前 Chromium 和上述视口，不代替真实登录、组织切换、隔离或发布证明。

## 成员管理 Feature Stories

新增 37 个正式成员 Feature 场景，聚焦检查 1 文件/37 项全部通过，退出码 0。覆盖目录默认、加载、空、错误、401/403、长文本、三语/RTL、慢请求、筛选/分页、URL 自定义角色及 access 失败；角色修改、成员移除与离开弹层覆盖键盘、焦点恢复、提交禁用、409 草稿复核、429/503 手动重试、401/403 和最后 owner。委派、仅 update、仅 delete、权限查询失败、只读成员与 admin 的身份限制分别核对，角色目录另覆盖加载和错误。日志为 `/private/tmp/enterprise-admin-s8-members-stories-settled-final.log`；租户类型检查和 Storybook 构建均退出 0。

场景发现正式 UI 原先以 owner/admin 身份决定是否显示成员管理动作，遗漏已获 member:update/delete 的自定义角色，且 admin 无法更改普通 member。现在通过原生 hasPermission 分别读取 update/delete，owner/admin 身份保护与禁止移除自己仍保留。member:update 不授予 ac:read；委派角色不请求受限角色目录，当前角色名称来自已授权的成员目录，内置选择保持既有权限边界。角色目录加载和错误明确展示，未创建额外角色读取接口。

真实浏览器回归在旧生产构建稳定失败：委派角色的目标成员更改角色按钮不可见，日志为 `/private/tmp/enterprise-admin-s8-members-delegated-ui-red.log`。修复后 `tests/e2e/custom-roles.test.mjs` 6 项全部通过，退出码 0，日志为 `/private/tmp/enterprise-admin-s8-members-custom-roles-e2e-final.log`。新增流程核对受限目录 GET 403、角色写入 POST 200 与数据库 member 读回、移除 POST 200 与 Membership 删除、全局 User 保留、两项审计事件及搜索焦点恢复；owner/admin 和自身移除入口受限。现有语言子菜单测试改用明确的键盘 Enter 打开，符合 Base UI 子菜单交互，不使用强制点击或重试掩盖失败。

原生构建检查发现共享危险按钮在悬停动画结束后仍不足 4.5:1：第一次浅色调整为 4.34:1，既有深色为 4.4:1。现在共享 destructive 色值分别调整为浅色 `oklch(0.46 0.2 27.325)`、深色 `oklch(0.74 0.17 22.216)`，保持原有按钮结构和动作语义；实际原生 hover 及动画完成后的 axe 检查分别核对，不能以模拟 hover 的 Story 通过推导真实 CSS 对比度。两种主题失败日志为 `/private/tmp/enterprise-admin-s8-members-render-all-red.log`。

最终 Storybook 构建的原生浏览器检查退出码 0，日志为 `/private/tmp/enterprise-admin-s8-members-render-final.log`。5 个场景为成员键盘修改/移除、RTL、长文本、390 像素窄视口长文本和深色；页面及 main 的 scrollWidth 均等于 clientWidth，无 pageerror。浅/深主题真实悬停等待颜色动画结束后 axe 均无违规；深色截图另等待主题过渡完成。原生 Enter 打开角色弹层，End/Enter 选择动态角色，Enter 保存和确认移除后分别恢复动作按钮与搜索焦点。

5 张截图已查看，位于 `/private/tmp`：`enterprise-admin-s8-members-native-keyboard.png`、`enterprise-admin-s8-members-rtl.png`、`enterprise-admin-s8-members-long-text.png`、`enterprise-admin-s8-members-long-text-narrow.png` 和 `enterprise-admin-s8-members-dark.png`。390 像素是实际浏览器视口；深色仅切换该 Feature 产物的主题 class，未证明持久化主题设置。UI fixture、当前 Chromium 和这些视口的渲染证据不替代真实身份、跨组织、RLS 或发布证明。

本批首次完整检查退出 1，Storybook 为 289 通过/3 失败：两张语言表单的陈旧版本再次提交失败，组织语言保存失权场景检查到仍在关闭中的未命名 listbox；成员 37 项通过。日志保留为 `/private/tmp/enterprise-admin-s8-members-verify-first.log`。版本冲突原先异步触发版本读回，却提前结束提交周期；现在等待同一次读回完成再解除提交锁定，保留草稿。MSW 在冲突后加入 700 毫秒读回等待，最小检查稳定复现两张表单保存按钮未禁用，日志为 `/private/tmp/enterprise-admin-s8-locale-refresh-lock-final-red.log`。

语言场景另等待真实关闭属性、动画完成和选项不可见；Base UI 关闭后可能保留隐藏选项，因此不把 DOM 卸载作为业务要求。修复后成员及个人/组织语言 3 文件/81 项全部通过，退出码 0，日志为 `/private/tmp/enterprise-admin-s8-members-locale-focused-final.log`。仅测试辅助函数导入或过严卸载断言造成的中间失败不作为产品回归证据。

## 成员与语言读回批次完整检查

第二次完整 `pnpm verify` 在最终源码上退出 0：API 155 项（Nest 15、真实业务 HTTP 140）、浏览器 11 文件/76 项、Storybook 20 文件/292 项、数据库 2 文件/24 项、性能 2 项及单元 74 项全部通过。peer、lint/工程边界、类型、i18n、38 页文档内容、数据库 Schema、生产构建及 OpenAPI/Orval 可重现检查全部通过。日志为 `/private/tmp/enterprise-admin-s8-members-verify-final.log`。执行前后成员 9 个及语言读回 5 个源码文件的 SHA-256 一致；最终验收文档另执行定向格式和文档内容检查。

## 尚未完成的验收

- 平台组织、用户目录、审计、设置、租户审计、个人/组织语言设置及成员管理已补足上述 Feature Stories；Invitations/Roles 仍需逐项补足，不能用 API 或公共 Stories 替代。
- 安全回退入口和 ADR-0002/当前 CLI 的语义冲突等待用户确认；确认后完成实现、文档与对应发布验收。

本机验证与远端 CI、生产部署分别记账；本记录不声称 GitHub Actions 或生产发布已通过。

迁移/性能批次已通过 `pnpm db:check` 和包含 0037 的 Compose 验证。组合浏览器批次已通过完整 `pnpm test:api`（Nest HTTP 15 项及业务 HTTP 130 项，共 145 项）、`pnpm test:e2e`（11 文件、73 项）、`pnpm test:storybook`（13 文件、97 项）、`pnpm lint`、`pnpm typecheck`、API/双 SPA 生产构建及 `pnpm api:check`；文档内容检查覆盖 38 页。这些是此前批次的历史证据，最新结果以上文为准，仍不替代待完成的发布验收。
