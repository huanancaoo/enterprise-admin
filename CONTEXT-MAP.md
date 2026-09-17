# Context Map

## Contexts

- [身份与组织](./apps/api/CONTEXT.md): 用户、组织与两种操作者；两个操作面共用的 HTTP 运行时
- [租户后台](./apps/tenant/CONTEXT.md): 租户操作者的产品操作面
- [平台后台](./apps/platform/CONTEXT.md): 平台操作者的产品操作面

## Relationships

- **租户后台 → 身份与组织**: 租户操作者通过同一个 API Host 进入并作用于某一个组织
- **平台后台 → 身份与组织**: 平台操作者通过同一个 API Host 做跨组织或平台自身的运营
- **租户后台 ↔ 平台后台**: 无直接调用。共享后台领域组件，不共享操作面职责。能打开对方路由不是授权证明
- **组件工作台、Worker**: 不是 context，也不是操作面
