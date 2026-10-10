# Worker

Worker 是默认启用的核心运行时，以独立 Node 进程执行组织成员授权业务任务。生产注册表当前为空；本次交付只证明任务基础设施，没有新增异步业务或管理页面，也不启动 API、邮件或 Files 运行时。

从 `.env.example` 配置 `.env`，由 `pnpm --filter worker dev` 或 `pnpm --filter worker start` 启动。本机启动使用 `.env`，生产 `pnpm --filter worker start:prod` 使用部署环境注入；启动和退出均不执行迁移。

数据库身份必须是 `app_runtime` 且没有超级用户或 BYPASSRLS 权限。进程先建立数据库连接并校验真实角色，再等待 BullMQ 的 Redis 连接就绪，最后输出结构化 `worker_ready`。SIGTERM/SIGINT 停止领取新任务并等待活动任务；超过关闭期限非零退出。部署的停止期限须大于 `WORKER_SHUTDOWN_MS`，以便应用完成正常关闭。

任务定义和正式生产者来自 `@workspace/jobs`。注册项固定声明类型、严格输入 Schema、组织动作、资源策略、持久化幂等事实检查及执行方法；资源检查、幂等事实、业务变更与成功审计都使用同一当前授权 `TenantTx`。生产者与 Worker 均检查当前成员、组织状态和角色动作，浏览器 Session 不进入队列。

首次提交只有在读取 Redis 实际 Job 并核对身份和业务意图后才返回 `enqueued`；已有 Job 返回 `already_exists` 与队列状态，已有同意图业务事实返回 `already_completed`。连接或确认失败返回 `unknown`，仍保留原 Job ID。恢复权限不会自动重放已拒绝任务。成功/失败 Job 默认保留 7 天，清理后的幂等与冲突仍依赖业务持久化事实，不保证 Redis 永久丢失后任务不丢失。

| 环境变量                     | 默认值               | 范围                                            |
| ---------------------------- | -------------------- | ----------------------------------------------- |
| `REDIS_URL`                  | 必填                 | `redis:` / `rediss:`                            |
| `WORKER_QUEUE_NAME`          | `organization-tasks` | 小写字母开头，字母数字与连字符，最多 64 字符    |
| `WORKER_QUEUE_PREFIX`        | `jobs`               | `jobs` 或其 `-` / `_` 命名空间，与认证 key 分离 |
| `WORKER_ATTEMPTS`            | 3                    | 1–20                                            |
| `WORKER_BACKOFF_MS`          | 1000                 | 0–60000，指数退避                               |
| `WORKER_CONCURRENCY`         | 4                    | 1–128                                           |
| `WORKER_SHUTDOWN_MS`         | 30000                | 100–300000                                      |
| `WORKER_LOCK_DURATION_MS`    | 30000                | 100–300000                                      |
| `WORKER_STALLED_INTERVAL_MS` | 30000                | 100–300000                                      |
| `WORKER_MAX_STALLED_COUNT`   | 1                    | 0–10                                            |
| `WORKER_PRODUCER_TIMEOUT_MS` | 5000                 | 100–60000                                       |

生产者有界等待且不保留离线命令队列；消费者连接可在短暂 Redis 故障后重连。永久错误不重试，暂时执行错误按 attempts/backoff 有界重试。结构化日志记录任务身份、组织、原请求、尝试与分类结果；不记录 payload、Redis URL 或原始执行错误。队列失败只说明当前尝试失败，不会改写此前已提交的业务事实或成功审计。
