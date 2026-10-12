# 参与开发

先按 [README](README.md) 启动本地环境。Node、pnpm 与依赖版本以当前工作区配置和 lockfile 为准；使用冻结安装，不单独替换认证、数据库或前端状态栈。

新业务领域按 [模块开发指南](docs/guides/create-domain-module.md) 接入。认证身份、组织成员关系、平台任职是不同事实；租户数据必须通过 TenantTx 和 RLS 访问，不能因页面来自某个后台就认定请求具有权限。

开始修改前阅读 [Git 协作规范](docs/agents/git.md)。保留其他人的工作区与暂存区改动，每个提交只包含一个可独立审查的目的。提交遵循 Conventional Commits；破坏性变更必须明确说明升级影响。

验证按 [测试说明](docs/architecture/testing.md) 选择真实边界。源码改动运行 lint、typecheck 与受影响测试；契约变更重新导出 OpenAPI、生成客户端并审查差异；跨包依赖运行 lint:boundaries。数据库改动另遵循 [数据库说明](packages/database/README.md)。只改文档运行 docs check:content 和定向 Prettier 检查。

PR 说明具体触发条件、修改后行为、实际验证及未验证的边界。浏览器行为提供可复现流程；构建通过不能代替业务验收，模拟场景不能代替真实 SMTP、数据库、队列或恢复证据。

贡献提交按 [Apache-2.0](LICENSE) 授权。新增依赖必须保留其许可与归属，不能把含凭据的环境文件、备份、日志或生成的发行镜像提交进仓库。
