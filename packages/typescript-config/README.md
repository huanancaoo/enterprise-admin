# `@workspace/typescript-config`

工作区 TypeScript 共享配置，适用于当前 Vite 应用和以源码方式导出的 React UI 包。

## 配置分层

| 配置                 | 用途                                                                |
| -------------------- | ------------------------------------------------------------------- |
| `base.json`          | ES2022、ESNext 模块、Bundler 解析、strict、skipLibCheck             |
| `react-library.json` | UI 包：DOM/DOM.Iterable、React JSX、不输出编译文件                  |
| `vite.json`          | Vite 通用编译选项：ES2023、模块语法及未使用代码检查、不输出编译文件 |
| `vite-react.json`    | Vite 浏览器源码：DOM、vite/client、React JSX                        |
| `vite-node.json`     | Vite 配置文件：Node 类型、ES2023 标准库                             |

## 使用方式

使用方声明 `@workspace/typescript-config: workspace:*`，然后通过包名继承对应预设：

```json
{
  "extends": "@workspace/typescript-config/react-library.json",
  "compilerOptions": {
    "paths": { "@workspace/ui/*": ["./src/*"] }
  },
  "include": ["."],
  "exclude": ["node_modules", "dist"]
}
```

`paths`、`include`、`exclude`、`references` 和 `tsBuildInfoFile` 留在使用方配置中，因为这些相对路径属于使用方目录。

## 迁移边界

- 保留各使用方原有的 target、lib、模块解析及检查强度。Vite Node 原先未启用 strict，预设显式设为 false，避免继承基础配置后隐式改变检查范围。
- UI 直接导出源码，因此不继承旧模板的 declaration、declarationMap 和 NodeNext 配置，也不额外启用 noUncheckedIndexedAccess。
- `packages/ui/tsconfig.lint.json` 保留原有文件范围与输出选项并继承共享预设；当前 ESLint 不引用它。
- Admin 的根配置仍以 references 组织浏览器源码和 Vite 配置。其 `typecheck` 使用 `tsc -b`，确保真正检查两个引用项目。
- 未使用的 Next.js 模板已移除。
