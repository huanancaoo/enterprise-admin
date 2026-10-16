# `@workspace/rich-text`

项目富文本能力，供 API 内容校验与前端编辑器共用同一套官方 Tiptap 扩展配置。

- `@workspace/contracts` 仅描述 HTTP JSON 形状、严格属性、文件版本 UUID 与链接限制，不依赖本包或编辑器。
- 本包根入口组合协议约束与官方 ProseMirror 结构校验，导出 `ProjectEditorDocumentSchema` 和 `SaveProjectEditorContentSchema`，用于 API 内容入口与租户后台保存表单。
- `@workspace/rich-text/extensions` 提供同源扩展与文件节点，不导入校验入口或在顶层创建 Schema。`@workspace/admin/rich-text-editor` 在此基础上添加 React NodeView 和上传交互。

普通 API 客户端、后台组件和任务 worker 无需导入本包。编辑器通过 Admin 的专用子路径使用，避免根导出将其副作用带入平台后台。
