# 业务模块指南独立照做验证

日期：2026-10-11。结论：最小 Labels 领域已从正式 Schema/迁移一路接到正式生成 SDK、React Feature 与真实浏览器，接入验收完成。Labels 仅在管理隔离 worktree 与源码 artifact 中，不进入产品 Root 的应用、数据库迁移或权限声明。

## 基线与源码

| 项                      | 已记录事实                                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 原始产品 HEAD           | `9880af6f40a0c9884305c27a1a5a5a717b253fe7`，产品 Root 仍有本轮授权 WIP                                                       |
| 隔离位置                | `/Users/huanancao/.codex/worktrees/framework-guide-validation/enterprise-admin`                                              |
| 精确框架基线 snapshot   | `00a636df1d5d3a8d5704491575ac178a53e52cad`；tree `1fc220c999a322aaaf98ec28c8491c3b833b455e`；相对原始 HEAD 的 284 个源码文件 |
| 已验收演示源码 snapshot | `55b6b2c406eb513cb86159f75240efa160c5bcdf`；41 个演示与正式生成文件                                                          |
| 工具链                  | Node `26.8.2`，pnpm `12.11.2`；同版本 frozen offline install 复用 1788 个包，无新依赖                                        |
| Artifact                | [精确基线、源码差异、准备脚本与证据](../artifacts/domain-guide-labels-2026-10-11.tar.gz)                                     |
| 指南                    | [新增租户业务领域](../guides/create-domain-module.md)                                                                        |

先创建干净的管理 worktree，再按精确 modified/untracked 非 ignored 文件清单捕获产品基线；文件复制前后核对 SHA256。Root 随后完成公共写入口和已整合 UI 的部分注册，隔离中逐文件检查无演示编辑后精确刷新，并记录为框架基线。没有覆盖或取消 Root 的工作和暂存状态，没有推送、PR 或上传。

基线 overlay 不包含真实 `.env`、密钥、ignored 文件、node_modules、dist 或 `.git`；修改过的公开 `.env.example` 也未复制。原始 HEAD 中的公开配置样例仍是源码样例。Artifact 的 `prepare.mjs` 只读取固定 Git 原始树，在独立空目录应用 overlay/patch 并校验 hash，不启动服务或访问数据库。本次已在 `/private/tmp/labels-guide-replay-check` 实际准备成功，284 个基线文件和 41 个演示/生成文件的 hash 均匹配。

## 最小领域与正式接入链

Labels 只有 UUID、非空组织归属和名称，提供列表、创建、删除及 `label.created`/`label.deleted` 成功审计。名称约束为非空；没有新增名称唯一性、分页、队列或其他业务规则。

正式链路为 Schema → `pnpm db:generate` 的 `0059_modern_trish_tilby.sql` → Drizzle custom `0060_labels-access.sql` → ENABLE/FORCE RLS 与仅 SELECT/INSERT/DELETE 的 app_runtime GRANT → 仅 TenantTx 的 Repository 与包 export → 固定 label 动作/角色声明 → contracts → Nest Controller/Module/AppModule → OpenAPI → Orval → api-client export → 正式 Router/侧栏/组织切换 → TanStack Form/Zod/Field 与单一 QueryClient → 三语言/RTL → 同一 Feature 的 Storybook/MSW 与真实 HTTP/浏览器。

API 使用已有 AuthRuntime Pool；写入注入正式 `TenantWrite.transaction`，业务与审计共用 TenantTx。前端使用既有 authClient、AuthGate、QueryClient 与 `organizationKeys.scope`。没有创建第二套认证、SQL Pool 或 QueryClient，没有复制 Files/Projects 授权 SQL，没有手写生成 DTO/请求函数，也没有测试专用 CREATE TABLE 代替正式迁移。

## 实际 red 与修正

1. 初始正式 HTTP 空列表返回 404；正式注册、登录和创建组织均成功。Schema/迁移、permissions/contracts、Nest 与 Orval 列表接入后该 slice 通过。
2. 创建 HTTP 在尚无 POST 入口时返回 404；接入实际创建代码后编译出现 `TS2724`（无 TenantWrite 导出）及 `TS2353`（审计 input 不接受 resourceType）。主 agent 修复通用 TenantWrite、DB 当前 actor kernel 和必填资源类型，既有 Project consumer 显式传 project。Labels 沿修复后的正式入口创建并记录正确 label 分类。
3. 审计首个断言错误地期待 HTTP 原样返回存储 fields。正式 Contract 使用 metadata，且新事件不在公开白名单时为 `{}`。验收纠正为事件 code、actor、资源及结果；没有为通过测试公开原始业务字段。
4. 删除在尚无 DELETE 入口时真实 404；实现同事务删除与审计后，CRUD 与审计读回 3/3 通过。
5. 完整数据库测试首次 109/110：正式表目录遗漏本轮框架表与 Labels；重复 migration/ledger 本身已通过。维护明确表目录后 110/110 通过，没有修改正式 migration 迎合旧断言。
6. 浏览器首次真实登录后找不到 Labels 标题。接入正式 Router、页面、表单和 namespace 后通过；捕获时仍在整合的 Root UI/namespace 文件按就绪通知精确刷新。
7. 全仓检查发现隔离公共 audit 字段插入的格式与演示 Storybook Testing Library `exact` 参数问题，已修正。其余翻译/类型失败来自已捕获旧版 Root 文件，刷新已正式修复的源码后通过。

## 验证结果

| 执行项                                       | 实际结果与证据范围                                                                                                                                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Labels 正式 SDK → HTTP → 正式迁移 PostgreSQL | **8/8**：创建/列表/删除及对应审计；跨组织资源 404、非成员 403、匿名 401；member 只读且写/审计 403；空名称/组织覆盖 400；审计故障创建/删除都回滚并从 HTTP 读回；真实 CHECK `23514`、无 scope 隔离；8 次请求跨两组织并发不串且逐项审计 |
| 真实浏览器                                   | **4/4**：正式侧栏导航、Field 无效输入、实际 POST 延迟期间控件禁用/仅一请求、创建列表、取消/确认删除及审计；真实审计故障 HTTP500 保留草稿；真实 member 只读；同页 English/Arabic、RTL 和 URL 无 UI 语言                               |
| 同一正式 Feature 的 Storybook/MSW            | **7/7**：空态、加载、列表失败、只读、长文本/删除取消焦点、无效输入/慢提交、Arabic RTL；这些是展示与无障碍证据，不代替真实授权                                                                                                        |
| 完整数据库 suite                             | **110/110**，含正式 bootstrap/one-shot migration、重复 ledger、角色分权、RLS、回滚与隔离                                                                                                                                             |
| 全仓 lint / typecheck                        | 均 **22/22**；之后最终 Query Key 改用公共 scope 的 tenant lint 也通过                                                                                                                                                                |
| 完整构建                                     | **12/12**；用于最终浏览器重放的正式产物                                                                                                                                                                                              |
| Schema / API 生成链                          | db:check 通过；api:check 重放 OpenAPI/Orval 后无漂移                                                                                                                                                                                 |
| 国际化                                       | **983 键/13 namespace**，zh-CN、en-US、ar 键/值/插值一致并通过正式 lint/extract/types/status/catalog 检查                                                                                                                            |
| 文档                                         | check:content **38 页**；指南与报告 Prettier 检查；artifact 实际准备与逐文件 hash 校验                                                                                                                                               |

业务事实只由正式 SDK/HTTP 与真实页面读回。独立管理员连接仅用于已确认的数据库隔离 seam：owner/GRANT/RLS/约束观察，以及在随机测试库临时撤销并恢复审计 INSERT 权限以验证回滚。测试结束释放本次创建的 PostgreSQL/Redis/浏览器资源；未使用开发或生产数据库。

登录后的真实截图包含在 artifact 的 `evidence/created-zh-CN.png`、`evidence/readonly-zh-CN.png`、`evidence/rtl-ar.png`。没有保存登录密码、Cookie 或网络 trace。

## 重放与边界

Artifact README 提供从原始 HEAD 准备精确源码、frozen install、正式生成、构建及本次各验收命令。本次本机 CLI 前缀为 `PATH=/private/tmp/framework-pnpm-probe/node_modules/.bin:/Users/huanancao/.nvm/versions/node/v26.8.2/bin:$PATH`；Docker 使用既有 OrbStack socket。

本次没有重跑所有 unit/API/E2E 用例，没有将聚焦 API 8/8、浏览器 4/4 或 Storybook 展示记作全产品流程验收。Labels 专属验收未覆盖执行中 Session/成员撤销竞态或新领域 API Key scopes；本报告不以源码或其他能力的测试替代这些边界。没有生产部署、外部 SMTP/Webhook 投递或发行/恢复验收；那些能力保持各自的证据与授权边界。
