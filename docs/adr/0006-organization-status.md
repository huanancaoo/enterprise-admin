---
status: accepted
date: 2026-09-17
---

# 组织是否在运营记为组织状态，不用 runtime 或 enabled

组织是否仍在运营是独立于 Membership 和权限的事实，用组织状态表达，取值只有 ACTIVE 与 SUSPENDED。物理来源是 `organization_status`。规格曾用 `organization_runtime_state`，但 runtime 表示程序运行时，与组织是否在运营无关；S4 的 `enabled` 布尔字段在核对既有停用事实后移除，不能与组织状态并存。

## 影响

缺失状态失败关闭，不能当作 ACTIVE。新组织由 `organization` INSERT 触发器建立 ACTIVE 行，不把 Better Auth afterCreate 当作状态写入点。术语见 [CONTEXT.md](../../CONTEXT.md)，读写边界见 [S8 集成约束](../architecture/s8-integration-contract.md)。
