import { NotificationEmailDelivery } from './notification-email-delivery';
import { Module, type DynamicModule } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { NotificationsController } from './notifications.controller';
import { Notifications } from './notifications';

import {
  notificationsConfig,
  type NotificationsConfig,
} from './notifications-config';

@Module({
  imports: [TenancyModule],
  controllers: [NotificationsController],
  providers: [Notifications, NotificationEmailDelivery],
})
export class NotificationsModule {
  static forRoot(config: NotificationsConfig): DynamicModule {
    return {
      module: NotificationsModule,
      providers: [{ provide: notificationsConfig, useValue: config }],
      exports: [Notifications],
    };
  }
}
