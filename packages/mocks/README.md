# @workspace/mocks

S6 的共享网络模拟来源，仅依赖 HTTP Contracts，不访问数据库。

- `fixtures/projects.ts`：两个组织与三语言的 Projects 数据；保持各组织资源 ID 和响应归属独立。
- `handlers/projects.ts`：复用 `ProjectListQuerySchema`，按返回语言的名称筛选，处理状态、排序、分页及结构化错误。越界页返回空 items 并保留 total。
- `scenarios/projects.ts`：success、empty、forbidden、serverError、slow、loading、longText。

Storybook 通过 `msw-storybook-addon/csf3` 的 loader 初始化 Worker，`parameters.msw.handlers` 选择场景；Vitest Node 测试用同一组 handler 与 `setupServer`。慢网络延迟 700ms，持续加载使用 MSW infinite delay。

Mock 覆盖已交付的 Projects List 契约，不模拟尚未交付的 Update/Delete、认证或平台能力，也不能作为真实权限或数据库隔离证明。测试入口为根目录 `pnpm test:unit` 和 `pnpm test:storybook`。
