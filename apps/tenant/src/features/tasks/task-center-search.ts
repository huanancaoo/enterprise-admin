import {
  BusinessTaskIdSchema,
  CapabilityPageQuerySchema,
  TaskCenterItemSchema,
} from "@workspace/contracts/framework-capabilities"
export const taskCenterSearchSchema = CapabilityPageQuerySchema.extend({
  source: TaskCenterItemSchema.shape.source.optional(),
  taskId: BusinessTaskIdSchema.optional(),
})
export type TaskCenterSearch = ReturnType<typeof taskCenterSearchSchema.parse>

export type TaskCenterItem = ReturnType<typeof TaskCenterItemSchema.parse>
