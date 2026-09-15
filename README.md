# shadcn/ui monorepo template

## 架构基线与 S0

本项目的多租户实施基线见 [Architecture Baseline ADR](docs/adr/0001-architecture-baseline.md)，阶段结果见 [S0 验收记录](docs/architecture/s0-validation.md)。运行时固定为 Node 26.8.2 / pnpm 12.4.1。依赖以兼容为准，完整验收运行 `pnpm verify`。

完整复现步骤见 [S0 验证工程](tools/s0/README.md)，验收入口为 `pnpm verify:s0`。

This is a Vite monorepo template with shadcn/ui.

## Adding components

To add components to your app, run the following command at the root of your `web` app:

```bash
pnpm dlx shadcn@latest add button -c apps/web
```

This will place the ui components in the `packages/ui/src/components` directory.

## Using components

To use the components in your app, import them from the `ui` package.

```tsx
import { Button } from "@workspace/ui/components/button"
```
