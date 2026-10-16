# Better Auth Open API 集成依据

研究与集成日期：2026-10-16。用户选择接入官方插件，并将认证接口加入现有开发者文档站。

## 官方能力与当前版本

项目锁定 Better Auth 1.7.5，`openAPI` 已包含在 `better-auth/plugins` 中，无需新增依赖。该版本生成 OpenAPI 3.1.1，提供服务端 `auth.api.generateOpenAPISchema()`、默认 Scalar 页面 `/api/auth/reference` 和 JSON 端点 `/api/auth/open-api/generate-schema`。依据：[官方文档](https://better-auth.com/docs/plugins/open-api)、[v1.7.5 插件源码](https://github.com/better-auth/better-auth/blob/v1.7.5/packages/better-auth/src/plugins/open-api/index.ts)、[v1.7.5 生成器](https://github.com/better-auth/better-auth/blob/v1.7.5/packages/better-auth/src/plugins/open-api/generator.ts)。

`disableDefaultReference` 只关闭 Scalar 页面，插件不会根据 `NODE_ENV` 自动关闭这两个端点。项目已有 Nest Swagger 在生产环境关闭 UI 和 JSON，因此认证配置通过 Better Auth 原生 `disabledPaths` 同时关闭上述两个 HTTP 路径；服务端 API 仍可生成构建快照。依据：[插件实现](https://github.com/better-auth/better-auth/blob/v1.7.5/packages/better-auth/src/plugins/open-api/index.ts)、[原生路由的 disabledPaths 检查](https://github.com/better-auth/better-auth/blob/v1.7.5/packages/better-auth/src/api/index.ts)、[项目 Swagger 配置](../../apps/api/src/openapi/setup-swagger.ts)、[共享认证配置](../../packages/database/src/auth.ts)。

## 项目接入边界

`pnpm api:openapi` 使用正式应用的注册入口，分别导出 Nest 的 `openapi.json` 和 Better Auth 的 `auth-openapi.json`。两份规范保持各自版本和元数据，文档站使用 fumadocs-openapi 的多个输入生成参考页。Orval 继续只读取业务快照，认证调用继续使用 Better Auth Client。依据：[导出入口](../../apps/api/src/openapi/export-openapi.ts)、[文档输入](../../apps/docs/lib/openapi.ts)、[文档页面来源](../../apps/docs/lib/source.ts)、[Orval 配置](../../orval.config.ts)。

Better Auth 生成器读取当前配置、端点与模型元数据，并排除 `disabledPaths` 中的接口。因此认证快照跟随实际启用的插件及原生端点元数据；它不会自动补写项目业务 hook 的说明。当前凭据管理原生 HTTP 路径仍被禁用，不会因文档集成而重新开放。依据：[原生生成器](https://github.com/better-auth/better-auth/blob/v1.7.5/packages/better-auth/src/plugins/open-api/generator.ts)、[认证配置与业务 hook](../../packages/database/src/auth.ts)。

生成快照不查询数据库或 Redis；实际 HTTP 文档请求仍经过项目启用的认证限流。验证分别覆盖原生 handler 的开发/生产访问边界，以及文档站多规范生成页面的路径唯一性和认证请求 base URL；完整文档构建与浏览器验收另作为运行证据。依据：[认证边界测试](../../tests/unit/auth-openapi.test.ts)、[文档接入测试](../../apps/docs/tests/auth-openapi.test.ts)。
