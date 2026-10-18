# 本地运行观测与告警

发行 Compose 默认包含 Pino JSON 操作日志、OTel Collector、Prometheus 与 Jaeger。业务审计仍保存于 PostgreSQL，不用运行日志代替审计事实。

HTTP 在服务端产生 requestId，响应通过 `X-Request-Id` 返回；日志与 span 记录同一标识，不信任客户端任意关联头。BullMQ 官方 telemetry 接口把 trace context 保存在传输元数据中，业务任务 envelope、Job 身份和意图 fingerprint 不因此改变。

HTTP 响应由 `on-finished` 汇总完成、断连与 socket 错误，每个请求只结束一次观测。完整写出记录 `http.request.completed`，提前断连记录 `http.request.aborted`，socket 错误记录 `http.request.error`；未发出响应头时不记录默认 200。断连和 socket 错误的 span 标记为 Error，`error.type` 分别使用固定值 `http.response.aborted` 和 `http.response.error`；完整写出的 5xx 使用状态码字符串。同样的分类进入耗时指标，避免中断请求丢失或被计为成功。

日志只记录路径、动作、结果和耗时等操作事实，不记录认证 Header、Cookie、请求体或查询串。指标使用服务、固定路由、任务类型、队列和稳定错误分类，不把用户、组织、资源或 requestId 作为指标 label。

OTLP 导出只保留关联标识、HTTP/任务分类和时序等明确字段，不发送自由文本 status message、原始 exception message/stacktrace、Job 输入/结果/选项或失败原因。任务错误分类和重试仍由原业务运行时处理，观测投影不改变队列或事务行为。

## 查询

Prometheus 默认仅在 `127.0.0.1:9090`，Jaeger 查询 UI 在 `127.0.0.1:16686`；端口由发行环境示例明确配置。OTLP HTTP 接收端用于本地联调。API/Worker 在私有 Docker 网络向 Collector 发送信号。

```sh
docker compose -p <project> --env-file <release.env> -f compose.release.yaml logs --no-color api worker
node infra/observability/check-alerts.mjs
```

指标包括 HTTP 时延/状态、进程运行时间、队列等待/活动/延迟/失败数量及任务执行失败。Jaeger 使用当前稳定 v3 查询 API；按 requestId 搜索相应 span，再查看 HTTP/Queue/Worker 关联。当前 Jaeger 使用有界内存存储，重启清除 trace；核心恢复范围仍为 PostgreSQL、Files 和 Redis。

## 规则与证据

本地规则覆盖 API/Worker 持续缺信号、任务持续积压、暂时执行失败和 HTTP 5xx；正常流量、403 与授权撤销后的永久拒绝不作为系统执行故障告警。规则文件和阈值是部署配置，维护窗口须由操作方安排告警静默。

`promtool` 场景验证规则在给定时间序列上的触发与静默；`telemetry-stack` 用例通过真实 HTTP、Collector、Prometheus 查询与 Jaeger trace 读回证明传输链路。两种证据分别记录，不把规则样本称为外部通知投递证明。实际外部告警接收渠道由部署方明确配置，本次本地验收不发送给第三方联系人。

`telemetry-failure` 使用正式生产者、真实 Redis、独立 Worker 和 TenantTx 制造绑定私密参数的 SQL 失败，验证两次执行、原失败分类与事务回滚，并检查 OTLP 不包含错误诊断内容。正常 GET 的 Cookie 检查不能代替该错误路径证据。

```sh
pnpm exec vitest run --config vitest.config.mjs --project release tests/release/alerts.test.mjs tests/release/telemetry-stack.test.mjs tests/release/telemetry-failure.test.mjs
```

## 平台运行监控

“系统监控 → 运行监控”要求独立的 `platform.monitor:read` 权限，页面每 30 秒读取一次服务端聚合结果。PostgreSQL、Redis 和文件存储分别进行只读探测；存储未启用时明确显示“未启用”。组织任务队列与平台任务队列分别展示，平台任务执行器位于 API 进程内，组织任务 Worker 是独立进程。队列计数不包含任务输入、结果或失败诊断。

API 的 `MONITOR_PROMETHEUS_URL` 由部署指定，发行 Compose 使用内部 Prometheus 地址。`MONITOR_TIMEOUT_MS` 限制单次探测等待，默认 3000 毫秒。浏览器不能传入查询地址、PromQL 或部署连接信息。查询源未配置、不可访问、没有样本时分别显示相应状态；不会把缺少数据视为正常。组织 Worker 超过 90 秒未产生运行指标时显示信号过期。HTTP 指标使用最近 5 分钟的 API 请求样本，提供请求速率、5xx 比例、平均耗时和 P95 耗时。

## 本机开发接入

`compose.observability.yaml` 只包含 Collector、Prometheus 和 Jaeger，复用发行镜像配方与观测配置。使用当前 PostgreSQL、Redis、存储所在的 Compose 项目名启动这三个服务，不重建业务底座。以下命令中的 `enterprise-admin` 应与当前本机项目名一致；不要附加 `--remove-orphans`。

```sh
docker compose -p enterprise-admin -f compose.observability.yaml up -d otel-collector prometheus tracing
```

首次使用且本机尚无三个发行观测镜像时，先构建对应目标：

```sh
docker compose -p enterprise-admin -f compose.observability.yaml build otel-collector prometheus tracing
```

API 与独立 Worker 均需设置 `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318`，API 另需设置 `MONITOR_PROMETHEUS_URL=http://127.0.0.1:9090`。这些仅是本机进程连接配置，不进入前端环境变量。沿用各应用现有 `.env` 中的数据库、Redis 和存储配置启动：

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 MONITOR_PROMETHEUS_URL=http://127.0.0.1:9090 pnpm --filter api dev
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 pnpm --filter worker dev
```

默认指标每 10 秒导出，Prometheus 每 15 秒采集。首次启动需要等待实际采样；HTTP 速率与耗时需要请求和多个采样点，页面在此前显示“暂无数据”。`http://127.0.0.1:9090/-/ready` 可检查 Prometheus 就绪，Jaeger 查询界面位于 `http://127.0.0.1:16686`。停止开发观测时只停止这三个服务：

```sh
docker compose -p enterprise-admin -f compose.observability.yaml stop otel-collector prometheus tracing
```
