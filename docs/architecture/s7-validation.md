# S7：Projects 全链路业务流程验收

日期：2026-09-17。范围为 [实施计划 S7](implementation-plan.md#s7完成-projects-全链路每个操作纵向交付)。基于 S5 契约与 S6 共享 UI/i18n 基础，纵向闭环 Projects 业务领域全生命周期；工作区在开始时已完成 S5 与 S6 验收。

## 交付与边界

| 任务             | 后端与契约                                                                         | 前端                                                                     | 实现与验收证据                                                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S7-01 列表       | List Query、Repository scope、分页/排序/筛选、OpenAPI 快照与 Orval 客户端          | Router Search (`validateSearch`) → Query → `DataTable`                   | URL 同步 `page/pageSize/name/status/sortBy/sortOrder`；受控受托分页；刷新页面保持筛选/排序/页码；租户切换基于 React `key={organizationId}` 隔离，不串视图状态。 |
| S7-02 创建       | 组织权限检查 (`project:create`)、租户事务、数据插入与 `project.created` 结构化审计 | `ProjectCreate`（TanStack Form + Zod）嵌入 `ResourceList` 动作区         | 组织归属由安全上下文绑定，客户端 Body 无法篡改；提交校验阻断空标题；创建成功后自动关闭弹窗、重置表单并使列表缓存失效；失败保留草稿。                            |
| S7-03 详情与更新 | Get / Patch 路由、Domain Policy 鉴权、`project.updated` 审计                       | `ProjectDetail`、`ProjectEdit`（`FormDialog` + 字段控件）                | 路径参数严格校验；只能修改授权租户内资源；状态流转（draft / active / archived）与元数据编辑；草稿在语言切换间独立维护，不被后台刷新静默覆盖。                   |
| S7-04 多语言内容 | `ProjectTranslations` Schema、`project:translate` 权限、复合唯一约束与外键         | 内容语言与界面语言分离；多语言草稿编辑；Arabic (ar) RTL 布局与文本自适应 | 语言切换时依据请求头 `Accept-Language` 准确解析对应语言的整条译文，杜绝字段混杂；支持中/英/阿多语言维护；项目硬删除时外键级联清理所有译文。                     |
| S7-05 删除       | 组织动作权限与 Domain Policy、安全租户事务、级联删除与 `project.deleted` 审计      | `ConfirmDangerAction` 确认警告弹框                                       | 确认弹窗防误触；确认后执行硬删除，列表项同步移出、总记录数即时更新；删除后原详情 URL 访问渲染 404；数据库验证主表与译文表彻底清除，不可篡改审计日志持久留存。   |

### 状态所有权与数据不变量

- **状态分工**：Router 管理组织路径和已应用列表条件（URL Search Params）；TanStack Query 管理服务端请求事实与缓存生命周期；`DataTable` 维护视图渲染与受控分页状态；TanStack Form 管理未提交的表单草稿。
- **界面语言 vs 内容语言**：用户界面语言由前端 `i18next` 运行时持有，不污染业务 URL；项目内容语言通过 API 明确传递并按语言存储在 `project_translations` 中。
- **审计与事务一致性**：业务变更与对应审计事件在同一 `TenantTx` 租户事务内原子提交；事件记录结构化 `eventCode`（`project.created`、`project.updated`、`project.translation.updated`、`project.deleted`）、`actorId`、`resourceId` 与上下文，不依赖本地化语句描述。
- **级联删除与审计持久性**：业务实体 `projects` 及其关联 `project_translations` 在删除后被物理清理，但 `audit_events` 表中的审计事实永久保留，不可篡改。

## 实际验证

使用 Node **26.8.2**、pnpm **12.4.1**。测试通过临时 PostgreSQL Testcontainers 运行，隔离安全。

| 命令 / 检查           | 结果         | 涵盖范围                                                                |
| --------------------- | ------------ | ----------------------------------------------------------------------- |
| `pnpm peers check`    | 通过         | 工作区 peer 依赖一致性                                                  |
| `pnpm lint`           | 通过         | 边界检查 (`pnpm lint:boundaries`) 与 12 个 lint 任务全部通过            |
| `pnpm typecheck`      | 通过         | 15 个 TypeScript 类型检查任务全部通过                                   |
| `pnpm i18n:check`     | 通过         | 提取 134 个 UI 键，中文、英文、阿拉伯语均完整，无未提取硬编码与缺失翻译 |
| `pnpm test:unit`      | 通过         | 24 个公共单元用例、4 个 API 单元用例全部通过                            |
| `pnpm test:api`       | 通过         | Nest HTTP 10 个用例、SDK → HTTP → 临时数据库 6 个用例全部通过           |
| `pnpm test:storybook` | 通过         | 5 个测试文件、26 个 Story 交互与 a11y 无障碍测试全部通过                |
| `pnpm test:e2e`       | 通过         | 13 个真实浏览器用例通过，耗时约 42s；包含 S7 完整业务全链路测试         |
| `pnpm db:check`       | 通过         | Drizzle Schema 与迁移一致性检查通过                                     |
| `pnpm test:database`  | 通过         | 数据库分权、迁移链与租户隔离测试全部通过                                |
| `pnpm build`          | 通过         | 7 个构建任务通过（admin、platform、api、storybook 等静态与服务端产物）  |
| `pnpm api:check`      | 通过         | OpenAPI 快照与 Orval 生成客户端无漂移                                   |
| **`pnpm verify`**     | **全部通过** | 串联上述所有门禁的一键全量验证通过                                      |

### 浏览器业务流程验收（E2E）

`tests/e2e/auth.test.mjs` 中的 `S7：完整业务流程 Login → Org → Create → Edit → DataTable Filter/Sort/Pagination → Delete 并验证审计与持久化` 完整覆盖了以下行为：

1. **认证与组织准入**：注册用户 `project-full-flow@example.com`，创建组织“全流程验收组织”，建立安全会话并进入组织控制台。
2. **列表基础数据准备**：通过租户运行器预先注入 24 个多状态项目，连同新创建的项目形成 25 条测试数据集。
3. **项目创建与表单生命周期**：
   - 打开创建弹窗，提交空标题触发前端表单验证阻断并呈现错误提示。
   - 输入“全流程核心项目”及初始草稿描述，提交后通过 Mutation 写入数据库，成功关闭弹窗并自动刷新列表。
4. **详情与多语言编辑**：
   - 进入项目详情页，校验核心字段渲染。
   - 打开编辑弹窗，修改状态为 `active`（活跃），并在阿拉伯语 (`ar`) 下验证表单的方向属性自适应变为 `rtl`。
   - 维护多语言译文（英文名称“Core Workflow Project”、英文描述），切换界面语言为 English 验证详情页整条译文正确解析且无中英混杂。
5. **DataTable 受控交互与状态恢复**：
   - 返回列表页，进行状态筛选（筛选“活跃”，显示 11 条），取消筛选恢复 25 条。
   - 名称搜索框输入“全流程核心项目”，精准命中 1 条且 URL 同步更新 `name=...`；清空搜索后恢复全部数据。
   - 点击“创建时间”表头触发列排序，URL 更新 `sortBy=createdAt`。
   - 点击分页器第 2 页（每页 20 条，共 25 条），URL 更新 `page=2` 且跨页展示剩余 5 条记录。
   - 刷新页面（`page.reload()`），验证 URL 依然保留 `page=2`、`sortBy=createdAt` 且数据显示正确。
   - 切回第 1 页并按降序排序，主项目稳定可见。
6. **确认硬删除与 404 处理**：
   - 点击“删除项目”，在危险确认框中先点击“取消”，验证对话框关闭且项目未被删除。
   - 再次点击“删除项目”并确认，验证页面跳回列表，列表项即时移出且总数递减为 24 条。
   - 直接通过浏览器地址访问已删除的项目详情 URL，页面稳定渲染“未找到项目”（404 状态）。
7. **底层数据库不变量与审计不可篡改性校验**：
   - 校验数据库中 `projects` 记录已为 `undefined`。
   - 校验 `project_translations` 表中相关译文已级联清空（空数组）。
   - 校验 `audit_events` 表中该项目的生命周期审计事件完整保留：包含 `project.created`、`project.updated`、`project.translation.updated` 以及 `project.deleted`。

验收截图保存于 `test-results/s7/workflow-success.png`。

## 验收限制与边界

- **S8 租户与平台管理边界**：用户 `preferredLocale` 和组织 `defaultLocale` 的后端持久化及跨会话恢复、组织成员与角色邀请调整、平台运营端能力属于 S8 范围，不在本阶段实现。
- **异步与高级任务边界**：文件上传（Files）、消息通知（Notifications）、后台队列与工作节点（BullMQ / Worker）属于 S9 范围，本阶段未引入 Redis 或额外后台队列。
- **本地化与样式提示**：构建产物中的 Rollup chunk 体积提示为常规打包提醒，不阻断构建与部署。

## 实施参考

- [多租户基础架构原文](multi-tenant-foundation.md)
- [实施计划](implementation-plan.md)
- [S6 验收记录](s6-validation.md)
