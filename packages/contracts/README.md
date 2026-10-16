# @workspace/contracts

HTTP 数据形状与业务属性约束的唯一来源，仅依赖 Zod。

Schema 按实际领域分文件，根入口聚合全部公开导出。运行时代码从所需领域的子路径导入，避免构造无关 Schema：

- `@workspace/contracts/api-error`：HTTP 客户端的错误解析，只依赖语言和文件错误详情。
- `@workspace/contracts/locale`、`/identifiers`：语言与身份标识的基础 Schema。
- `/project-query`：路由与列表查询，无富文本或文件响应依赖。
- `/projects`、`/organizations`、`/locale-settings`、`/audit`、`/platform`：对应业务领域。
- `/files`、`/file-batches`、`/project-files`、`/platform-storage`、`/personal-media`、`/framework-capabilities`、`/access-credentials`：文件与平台能力契约。

文件错误事实由独立模块定义，文件领域与 API 错误共同引用，不能从错误解析反向加载整个文件领域。类型导入可使用根入口；API 服务需要完整领域集合时也可使用根入口。

本包不得依赖 Drizzle、React、Tiptap 或富文本实现。完整编辑器语法由 `@workspace/rich-text` 使用官方 Schema 校验；文件 UUID、严格属性与链接约束仍在协议层维护。
