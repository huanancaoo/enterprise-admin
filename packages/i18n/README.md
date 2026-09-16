# @workspace/i18n

支持 `zh-CN`、`en-US`、`ar`，默认 `zh-CN`。资源位于 `src/locales/<locale>`：`common`、`auth`、`organization`、`projects`、`validation`，以及服务端错误码使用的 `errors`。

## 运行时

- 根入口供浏览器和服务端使用：Locale 协商、静态资源、`createUiI18n`、`createFormatter`。
- `getTranslator(locale)` 返回服务端固定语言 translator；不会调用服务器共享实例的 `changeLanguage`。
- `@workspace/i18n/react` 提供 `UiI18nProvider` 和 `useUiLocale`。每个 SPA 创建一个 UI 实例，Provider 订阅语言变化并同步 `html.lang/dir`，卸载时解除监听。
- UI locale 只由 i18next 持有，不写入 Router state 或后台 URL。S8 的用户/组织语言偏好持久化尚未实现；重新加载使用初始语言。
- `createFormatter(locale)` 支持数字、百分比、货币、日期和相对时间。`currency` 必须显式传币种，`dateTime` 必须显式传时区。语言不推导币种、时区或组织。

共享后台组件在 UiI18nProvider 内还须使用 `AdminDirectionProvider`，以便 Base UI 的键盘行为和 Portal 跟随 RTL。

## 翻译与门禁

从仓库根运行：

```sh
pnpm --filter @workspace/i18n exec i18next-cli extract
pnpm --filter @workspace/i18n exec i18next-cli types
pnpm i18n:check
```

提取后填写所有三种语言；生成目录通过 CLI 更新，不手改。类型增强由根入口导入，编译时检查 key 和 interpolation 参数。

`i18n:check` 已进入 `pnpm verify`，CI 通过原有 verify 步骤执行：

1. `lint`：共享后台与两个 SPA 的 JSX 文案、提示和可访问名称不得硬编码；翻译插值或字符串拼接错误也失败。Story 示例数据与 shadcn 基础源码不属于应用文案提取范围，使用方负责传入本地化业务标签。
2. `extract --ci --dry-run`：代码与目录存在漂移就失败，不改写 CI 工作区。
3. `types --ci`：生成类型不一致就失败。
4. `status`：源码中使用的键缺失就失败。
5. `check-catalogs.mjs`：六个 namespace、三语言 key 集合不一致、任意空值（含主语言）或插值参数不一致就失败；补充覆盖通过错误码动态查找的文案。

`errors:*` 和三种 Projects 状态是配置明确保留的有限动态键。不会自动引入其他语言或填入翻译兜底文案。
