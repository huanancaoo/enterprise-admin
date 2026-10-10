import type { RegisteredTask } from "@workspace/jobs"

// 生产业务尚未指定；测试处理器只在测试进程入口注册，不能由环境变量加载任意模块。
export const taskRegistry: readonly RegisteredTask[] = []
