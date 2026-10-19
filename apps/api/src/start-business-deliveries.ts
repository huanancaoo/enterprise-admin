import type { INestApplication } from '@nestjs/common';
import { NotificationEmailDelivery } from './notifications/notification-email-delivery';
import { PlatformSchedules } from './platform/schedules/service';
import { PlatformTasks } from './platform/tasks/platform-tasks';
import { WebhookDelivery } from './webhooks/webhook-delivery';

export function startBusinessDeliveries(app: INestApplication): void {
  // 只有 HTTP 运行入口启动外部投递；生成 OpenAPI 或创建 Nest context 不发送消息。
  app.get(PlatformTasks).start();
  app.get(PlatformSchedules).start();
  app.get(NotificationEmailDelivery).start();
  app.get(WebhookDelivery).start();
}
