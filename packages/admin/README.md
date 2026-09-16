# @workspace/admin

业务无关的后台组合组件，依赖 `@workspace/ui` 的基础组件。

## DataTable

从 `@workspace/admin` 导入 `DataTable`、`DataTableColumnHeader` 和列定义 helper。

- `createDataTableColumnHelper<T>()` 定义业务字段；列的 `meta.facetOptions` 同时声明多选筛选选项与标量字符串的匹配语义。筛选器按列定义顺序显示，无需另配 `filterFn` 或列 ID。
- `createDataTableSelectColumn<T>()`、`createDataTableRowControlsColumn<T>()` 创建固定尺寸、不可隐藏的选择列与行控制列。
- `DataTable` 统一组装搜索、筛选、选择操作栏、列设置、表格与分页。通过 `isLoading`、`empty`、`renderExpandedRow` 和 `renderSelectionActions` 传入内容，不暴露这些内部组件的组合方式。
- 批量操作接收当前筛选结果中跨页选中的行，与选择计数一致。具体业务操作由调用方实现。
- 保留 TanStack 的受控状态和 `manualPagination`、`manualFiltering`、`manualSorting`。URL 状态、请求与服务端数据语义由调用方负责。

使用方在导入 `@workspace/ui/globals.css` 的样式入口中，将本包源码加入 Tailwind `@source`。接入示例见 `apps/admin/src/styles.css`；交互测试见 `apps/storybook/src/data-table.stories.tsx`。

## S6 后台组件

- `AppShell`、`PageHeader`：侧栏、移动端导航、页面标题和操作区。
- `TenantSwitcher`、`LocaleSwitcher`、`PermissionGate`：工作区选择、UI 语言切换及展示权限；租户选择回调由应用连接 Router 或认证客户端，组件不自行授权。
- `FilterBar`、`Pagination`、`ResourceList`：承载筛选表单、受控分页和列表状态。`FilterBar` 用 `aria-busy` 表示请求进行中，不禁用输入；提交由 `onSubmit`（Enter）触发，操作按钮由调用方放入 children。`ResourceList` 在 `loading` 时优先渲染 children（表格骨架）。列表空态由 `DataTable` 的 `empty` 承载。`Pagination` 接收 `pageIndex/pageSize/rowCount/pageCount` 和修改回调；这些是调用方的当前事实，组件不再保存一份分页状态。
- `FormDialog`：受控弹窗和提交外壳。字段、Zod Schema、TanStack Form 草稿、提交结果由调用方持有；提交期间禁用字段与关闭操作。
- `LoadingState`、`EmptyState`、`ErrorState`、`PermissionDeniedState`：共享状态文案。

应用先用 `@workspace/i18n/react` 的 `UiI18nProvider` 提供实例，再用 `AdminDirectionProvider` 同步 Base UI 的方向。只使用语言和工作区控件时，从 `@workspace/admin/workspace` 导入，避免加载表格与编辑器模块。此 Provider 不建立第二份 locale 状态。

DataTable 自带文案使用翻译目录。列标题、业务状态与选项由调用方翻译；名称等租户内容直接来自 API。`showSearch={false}` 用于已有外部筛选表单的页面，防止出现无请求绑定的第二个搜索框；请求使用 `manualFiltering/manualSorting/manualPagination` 和受控分页。列宽拖拽及键盘调整遵循当前文字方向。

Projects 列表示例在 `apps/storybook/src/projects-example.tsx`，通过生成客户端调用共享 MSW。ResourceCreate/Edit/Show 随 S7 的真实操作补齐，本阶段没有通用 Resource Engine。
