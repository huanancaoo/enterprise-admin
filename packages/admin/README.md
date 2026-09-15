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
