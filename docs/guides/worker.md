# 核心 Worker 与组织业务任务

Worker 是默认必需的核心运行时。`pnpm dev`、开发 Compose 与每次发布都包含 Worker；没有可选 profile 或跳过开关。API Host 负责受理服务端业务请求，独立 Worker 负责执行已注册的组织业务任务。

当前生产注册表为空，本期交付的是任务基础设施。认证邮件、文件操作和保留维护继续使用各自已有的运行时；Worker 不加载 API Host，也不启动第二份邮件或 Files 调度器。

## 本地启动

先按[数据库说明](../../packages/database/README.md)初始化角色并完成迁移，再配置 Worker：

```sh
cp apps/worker/.env.example apps/worker/.env
pnpm dev
```

Worker 的 `DATABASE_URL` 与 API 使用同一运行数据库和 `app_runtime` 身份，`REDIS_URL` 指向已配置的 Redis。配置含全部默认值与范围的说明见 [Worker README](../../apps/worker/README.md)。单独开发或启动该进程可使用 `pnpm dev:worker` 或 `pnpm --filter worker start`；这些单进程命令不改变默认全系统启动范围。

Worker 验证数据库连接、真实运行身份和 Redis 就绪后输出 `worker_ready`。缺配置、数据库不可用或运行角色不正确时启动失败。API 与 Worker 都不执行迁移，也不持有迁移、bootstrap 或平台任职部署凭据。

## 业务模块接入

API Host 与 Worker 共用服务端专用的 `@workspace/jobs`。一个任务定义应完成下列约束：

1. 固定任务类型、严格输入 Schema 与所需组织动作。Schema 的 JSON 规范化应确定且幂等，生产者和消费者必须对同一输入得到同一业务意图。
2. 从可信服务端上下文提供 organizationId、actorId、resourceId、locale、requestId 和业务 idempotencyKey，不把 Session token 或凭据放入任务。
3. 在 `authorizeResource` 中通过传入 TenantTx 核对资源属于当前组织且符合领域策略。
4. 在 `findCommitted` 中按组织、发起用户、任务类型和幂等键协调并发，返回已提交事实的意图指纹与结果。
5. 在 `execute` 中用同一个 TenantTx 提交领域变更、持久幂等事实和成功业务审计。
6. 在生产者与 Worker 的服务端组合入口显式注册同一任务定义。不提供任意模块路径、任意代码或客户端选择权限动作的执行入口。

Worker 在组织锁内读取当前成员、角色与组织状态，再重建 TenantContext。成员移除、角色撤权、组织停用和资源范围拒绝为永久拒绝。浏览器退出或 Session 到期不会自行取消仍有当前成员权限的任务。

BullMQ Job ID 是队列去重身份，不能代替持久化业务幂等。Job 清理、并发重新领取或完成确认丢失后，处理器仍须证明业务副作用与成功审计只提交一次。同键不同业务意图返回冲突。

## 提交与执行结果

| 生产者结果          | 含义                                                        |
| ------------------- | ----------------------------------------------------------- |
| `enqueued`          | Redis 实际持久化的 Job 已读回，身份与业务意图已核对         |
| `already_exists`    | 队列已有同意图 Job，同时返回真实队列状态                    |
| `already_completed` | 当前授权下已查到同意图的持久业务成功事实                    |
| `unknown`           | 连接或确认失败，保留原 Job ID；调用方须按同一意图确认或重试 |

生产者有界等待且不离线排队；消费者自动恢复短暂断开的连接。暂时执行故障按有界 attempts/backoff 重试，永久拒绝不自动重试。恢复权限不会自动重放已拒绝 Job。

队列尝试失败与业务结果分开记录：业务已经提交后，进程可能在确认完成前死亡；如果重新领取时已经撤权，本次尝试会被拒绝，但此前业务成功事实和成功审计仍保留。不能为了读取历史结果绕过当前授权或 RLS。

本期不提供通用任务目录、事务投递 outbox、HTTP CRUD 或管理 UI。PostgreSQL 业务事务与 Redis 入队不构成原子事务；需要此语义的具体业务必须单独明确投递边界。非幂等外部服务副作用及 Redis 永久数据丢失不属于本期保证。

## 生产构建与发布

```sh
docker build -f infra/release/Dockerfile --target worker -t enterprise-admin-worker:local .
node infra/release/publish.mjs <compose-project> <env-file>
```

Worker 镜像独立构建，使用生产依赖和非 root 用户。发布配置必须提供 `RELEASE_WORKER_IMAGE` 的已验收 image ID 或 digest；固定顺序为 migrator 成功 → API → Worker → 双 SPA → smoke。Worker 未就绪时不发布后续 SPA，ready 日志须来自当前这次容器启动。

Redis 配置 AOF、数据卷和 noeviction，任务 key 使用与认证分开的 `jobs` 前缀。默认 Worker 关闭期限为 30 秒，Compose 给予 35 秒停止时间；正常退出停止领取并等待活动任务，超时非零退出，由重新领取与业务幂等恢复未完成的工作。

## 验证入口

```sh
pnpm test:worker
pnpm --filter @workspace/database test:database
pnpm exec vitest run --config vitest.config.mjs --project release tests/release/worker.test.mjs
```

测试复用现有真实 PostgreSQL、Redis、迁移与运行角色，通过正式生产者接口、独立 Node 进程及可观察业务事实和审计验收。测试专用处理器只在测试组合入口注册；真实 SIGKILL、SIGTERM、Redis 响应丢失和重启没有被内存队列替代。具体执行结果见 [S9 Worker 验收记录](../architecture/s9-worker-validation.md)。
