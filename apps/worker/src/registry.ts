import { readInvitationLimits } from "@workspace/database/invitation-command"
import type { RegisteredTask } from "@workspace/jobs"
import { createTenantExchangeTasks } from "@workspace/jobs/tenant-exchange"

// 注册表固定生产任务定义；测试处理器只在测试进程入口注册，不从环境变量加载模块。
export const taskRegistry: readonly RegisteredTask[] =
  createTenantExchangeTasks(readInvitationLimits(process.env))
