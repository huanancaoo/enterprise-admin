# docs

Tenaro 官方开发者文档站。基于 Next.js 与 Fumadocs，内容在 `content/docs`。

本地安装、配置与启动步骤的唯一维护入口是[根 README](../../README.md#快速开始)，公开入门页引用该入口；`docs/guides` 维护能力接入与运行语义，`docs/architecture` 中的历史研究与验收不替代运行指南。API 页面消费已提交的 OpenAPI 快照，快照路径同时声明为 Turbo 构建输入。

```sh
pnpm --filter docs dev
```

打开 http://localhost:3300 。URL 为 `/{locale}/{path}`，例如 `/en-US/architecture`。

| 命令            | 说明                            |
| --------------- | ------------------------------- |
| `dev`           | 本地开发，端口 3300             |
| `build`         | `next build`（不写入 Algolia）  |
| `search:sync`   | 把 `static.json` 同步到 Algolia |
| `check:content` | frontmatter、翻译配对、相对链接 |
| `test`          | 组件与内容门禁测试              |

环境变量见 [.env.example](.env.example)。搜索与 AI 需要 Algolia 与 OpenRouter 密钥。

发布说明在构建时读取 GitHub Releases，运行时每小时重新验证。共享网络中的匿名请求可能耗尽 GitHub 限额；在构建与运行环境中注入具有仓库内容读取权限的 `GITHUB_TOKEN`，只供服务端使用。CI 使用内置的只读 `github.token`。本地可通过进程环境或 `apps/docs/.env.local` 配置，令牌不得提交；配置入口与其余本地环境变量见根 README。
