# Jobs

任务基础设施通过 `@workspace/jobs` 提供任务定义、配置和 BullMQ 运行时。根入口不注册具体业务任务。

项目导入导出的注册表由 `@workspace/jobs/project-exchange` 提供，HTTP 提交和 Worker 使用同一套输入、权限、资源授权及幂等规则。文件编解码与项目写入实现仅在任务执行时加载；动态导入仍处于 Worker 的原租户事务内。

Worker 通过 `@workspace/jobs/business-task-observer` 和 `@workspace/jobs/business-task-dispatch` 显式接入持久业务任务的观察及派发。
