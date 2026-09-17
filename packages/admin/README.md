# @workspace/admin

业务无关的后台组合组件，依赖 `@workspace/ui` 的基础组件。

## DataTable

从 `@workspace/admin` 导入 `DataTable`、`DataTableColumnHeader` 和列定义 helper。

- `createDataTableColumnHelper<T>()` 定义业务字段；列的 `meta.facetOptions` 声明筛选选项。`meta.facetMode` 省略时为 `"multiple"`，以 `string[]` 和 `arrHas` 匹配；设为 `"single"` 时以标量字符串和 `equalsString` 匹配。筛选器按列定义顺序显示，无需另配 `filterFn` 或列 ID。
- `createDataTableSelectColumn<T>()`、`createDataTableRowControlsColumn<T>()` 创建固定尺寸、不可隐藏的选择列与行控制列。
- `DataTable` 是唯一表格装配入口，内部按工具栏、列设置、表体、选择与反馈拆分。独立 `Pagination` 不依赖表格 Context。调用方提供稳定的 `getRowId`；切换租户或资源集合时用 React `key` 重建表格，避免沿用上一集合的视图状态。
- `status` 为 `ready`（默认）、`loading`、`refreshing`、`error` 或 `forbidden`。首次/切换条件且无结果时使用 `loading`，保留工具栏与表头、显示骨架；同一查询后台请求时使用 `refreshing`，保留现有数据；`error` 展示失败与 `onRetry`，已有数据仍显示但禁用行操作；`forbidden` 隐藏数据、工具栏和分页，并清除选择。组件只呈现权限结果，授权仍由服务端执行。
- 空数据使用 `empty` 或默认空态；存在已应用条件时显示筛选无结果与清除条件；总数大于零但当前页为空时提供返回第一页，不自动改写 URL；全部列隐藏时提供恢复列入口。
- 搜索用 TanStack Form 保存未提交草稿，Enter 或搜索按钮提交后再 trim。外部已应用搜索变化时同步草稿，输入法确认候选词不会触发提交。`manualFiltering` 必须提供 `onResetFilters`，由页面在一次 URL 更新中清空全部筛选并回到第一页。
- 本地全量数据的批量操作接收当前筛选结果中跨页选中的行；`manualPagination` 只支持当前页选择，页码、每页数量、排序或已应用筛选变化后清空选择。表头全选只选当前页，计数与 `renderSelectionActions` 参数保持一致。服务端分页/筛选不显示由页内数据计算的选项计数。
- `isActionPending` 表示调用方的批量 Mutation 正在执行，冻结表格控件并保留选择；`renderSelectionActions` 提供业务操作、失败提示和重试入口。调用方负责异步结果，失败保留选择，成功后按操作语义清空选择；自行渲染的 Portal 菜单也应绑定同一 pending 状态。
- `renderExpandedRow` 负责业务展开内容。列重排只移动可配置列，控制列的位置和固定状态保留；列宽方向由当前 UI 语言统一决定。带 `facetOptions` 的列由封装根据 `facetMode` 配置筛选算法。
- 保留 TanStack 的受控状态与 `manualPagination/manualFiltering/manualSorting`。Router 持有已应用查询条件，Query 持有请求事实，Table 持有视图状态；不在组件内调用 API、做路由跳转或复制服务端数据。

使用方在导入 `@workspace/ui/globals.css` 的样式入口中，将本包源码加入 Tailwind `@source`。接入示例见 `apps/tenant/src/styles.css`；交互测试见 `apps/storybook/src/data-table.stories.tsx`。

## S6 后台组件

- `AppShell`、`PageHeader`：侧栏、移动端导航、页面标题和操作区。
- `TenantSwitcher`、`LocaleSwitcher`、`PermissionGate`：工作区选择、UI 语言切换及展示权限；租户选择回调由应用连接 Router 或认证客户端，组件不自行授权。
- `FilterBar`、`Pagination`、`ResourceList`：承载筛选表单、受控分页和列表状态。`FilterBar` 用 `aria-busy` 表示请求进行中，不禁用输入；提交由 `onSubmit`（Enter）触发，操作按钮由调用方放入 children。`ResourceList` 在 `loading` 时优先渲染 children（表格骨架）。Projects 使用 `ResourceList` 提供标题与页面操作，列表状态统一交给 `DataTable` 呈现。`Pagination` 接收 `pageIndex/pageSize/rowCount/pageCount` 和修改回调；这些是调用方的当前事实，组件不再保存一份分页状态。
- `FormDialog`：受控弹窗和提交外壳。字段、Zod Schema、TanStack Form 草稿、提交结果由调用方持有；提交期间禁用字段与关闭操作。
- `LoadingState`、`EmptyState`、`ErrorState`、`PermissionDeniedState`：共享状态文案。

应用先用 `@workspace/i18n/react` 的 `UiI18nProvider` 提供实例，再用 `AdminDirectionProvider` 同步 Base UI 的方向。只使用语言和工作区控件时，从 `@workspace/admin/workspace` 导入，避免加载表格与编辑器模块。此 Provider 不建立第二份 locale 状态。

DataTable 自带文案使用翻译目录。列标题、业务状态与选项由调用方翻译；名称等租户内容直接来自 API。没有名称搜索能力的页面使用 `showSearch={false}`；使用内置搜索时，调用方将受控状态连接到 URL 与请求，不能额外添加平行的筛选栏。请求使用 `manualFiltering/manualSorting/manualPagination` 和受控分页。列宽拖拽及键盘调整遵循当前文字方向。

Projects 列表示例在 `apps/tenant/src/components/projects-list.stories.tsx`，由公共 Storybook 加载；它以 Router 包装生产 `ProjectsList` 并通过生成客户端调用共享 MSW。ResourceCreate/Edit/Show 随 S7 的真实操作补齐，本阶段没有通用 Resource Engine。
