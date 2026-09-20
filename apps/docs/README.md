# docs

Tenaro 官方开发者文档站。基于 Next.js 与 Fumadocs，内容在 `content/docs`。

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
