# Context Map

## Contexts

- [身份与组织](./apps/api/CONTEXT.md): 用户、组织、组织成员与平台管理员；两个后台共用的 HTTP 运行时
- [租户后台](./apps/tenant/CONTEXT.md): 组织成员的产品操作面
- [平台后台](./apps/platform/CONTEXT.md): 平台管理员的产品操作面

## Relationships

- **租户后台 → 身份与组织**: 组织成员通过同一个 API Host 进入并作用于某一个组织
- **平台后台 → 身份与组织**: 平台管理员通过同一个 API Host 做跨组织或平台自身的事
- **租户后台 ↔ 平台后台**: 无直接调用。共享后台领域组件，不共享职责。能打开对方路由不是授权证明
- **组件工作台、Worker**: 不是 context，也不是产品操作面
