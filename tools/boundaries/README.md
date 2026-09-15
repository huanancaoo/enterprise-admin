# Workspace 依赖边界

运行 `pnpm lint:boundaries`；测试入口为 `pnpm test:unit`。

`checkBoundaries(root)` 在模块内调用 `pnpm list --recursive --depth -1 --json`，以 pnpm 实际识别的 workspace 为准，包括嵌套目录和排除规则。调用方只提供仓库根目录，无需提供包清单。运行环境须已安装仓库要求的 pnpm。

## 策略与识别分离

- `allowed` 只定义业务包允许依赖的 workspace，不负责发现包。
- 每个实际 workspace 必须具有 `allowed` 策略或带原因的 `exemptions` 条目。新包即使暂时无人依赖，缺少策略也会使检查失败。
- 仓库根目录、共享 ESLint/TypeScript 配置和 S0 工程显式豁免业务依赖矩阵检查，但仍作为依赖目标参与识别。业务包可复用根目录工程工具和共享配置，不能因此依赖 S0。
- 包名及子路径、TypeScript 解析后的路径和相对路径用于识别目标包；嵌套目录按最近的 workspace 归属，父包不会重复扫描子包。
- 检查 manifest 的四类依赖，以及静态 import/export、字符串动态 import/require 和类型导入。原有服务端依赖限制继续生效。

新增 workspace 后，在 `check.mjs` 中声明它的依赖策略；确属不参与业务分层的工程，则显式登记豁免原因。不要把新包手动加入另一份识别清单。
