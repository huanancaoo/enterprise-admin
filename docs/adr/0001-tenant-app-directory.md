---
status: accepted
date: 2026-09-18
---

# 租户后台目录用 tenant，后台领域组件仍叫 admin

租户后台和后台领域组件都叫 admin 时，平台后台依赖 `@workspace/admin` 会被读成依赖租户应用。决定把租户后台目录改为 `apps/tenant`，不改 `packages/admin`。包名表示两边共用的后台组合层；应用名表示租户操作面。路由 `/app` 不随目录改。

## Considered Options

- **改 `packages/admin`**（`panel` / `backoffice` 等）：碰撞来自应用名，不是组合层；否决
- **并进 `packages/ui`**：primitive 与后台组合层依赖图不同，ui 不允许 workspace 依赖；否决
- **保持 `apps/admin`**：admin 对 platform 不对称，且与后台领域组件同名；否决
- **目录用 `web` / `studio` / `portal`**：不与平台后台、租户操作者成对；否决
