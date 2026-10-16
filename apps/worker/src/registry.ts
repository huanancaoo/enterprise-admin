import type { RegisteredTask } from "@workspace/jobs"
import { projectExchangeTasks } from "@workspace/jobs/project-exchange"

// 注册表固定生产任务定义；测试处理器只在测试进程入口注册，不从环境变量加载模块。
export const taskRegistry: readonly RegisteredTask[] = projectExchangeTasks
