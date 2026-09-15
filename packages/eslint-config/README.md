# `@workspace/eslint-config`

所有 TypeScript 预设启用类型感知的 `@typescript-eslint/no-deprecated: error`，阻止调用声明为 `@deprecated` 的 API。文件须纳入所属包的 TSConfig；不要通过关闭规则绕过弃用检查。

工作区内 TypeScript 与 Vite React 的 ESLint flat config。使用 ESLint 10、TypeScript 6。

## 使用方式

在使用方声明 `@workspace/eslint-config: workspace:*`，并保留 `eslint`、`typescript` 开发依赖：

```js
import { createReactConfig } from "@workspace/eslint-config/react-internal"

export default createReactConfig(import.meta.dirname)
```

必须传入使用方目录：共享包自身的目录无法代表应用或 UI 包的 TSConfig 根目录，同一进程加载多个配置时不能依赖解析器自动推断。

## 预设范围

- `createBaseConfig`：针对 `.ts`、`.tsx` 启用 JavaScript 与 TypeScript recommended 规则，忽略 `dist`。
- `createReactConfig`：叠加 React Hooks recommended、Vite Fast Refresh 规则和浏览器全局变量，供 Admin 与其 UI 包共用。

保留迁移前的规则级别，不使用 `only-warn`，也不启用额外的类型感知规则。插件依赖集中在此包维护，使用方无需重复声明。未使用的 Next.js 模板及其依赖已移除。
