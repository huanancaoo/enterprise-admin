import type { EmailLocale } from "./locale.js"
export const taskEmailCatalog: Record<
  EmailLocale,
  { completed: string; failed: string; body: string; action: string }
> = {
  "zh-CN": {
    completed: "任务已完成",
    failed: "任务未成功完成",
    body: "你发起的导入或导出任务已有结果。请打开任务中心查看状态与报告。",
    action: "查看任务",
  },
  "en-US": {
    completed: "Task completed",
    failed: "Task did not complete",
    body: "Your import or export task has a result. Open the task center to view its status and report.",
    action: "View task",
  },
  ar: {
    completed: "اكتملت المهمة",
    failed: "لم تكتمل المهمة",
    body: "أصبحت نتيجة مهمة الاستيراد أو التصدير التي بدأتها متاحة. افتح مركز المهام لعرض الحالة والتقرير.",
    action: "عرض المهمة",
  },
}
