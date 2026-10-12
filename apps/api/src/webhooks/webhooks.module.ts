import { WebhookDelivery } from './webhook-delivery';
import { webhooksConfig, type WebhooksConfig } from './webhooks-config';
import { Module, type DynamicModule } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { Webhooks } from './webhooks';
import { WebhooksController } from './webhooks.controller';
@Module({
  imports: [TenancyModule],
  controllers: [WebhooksController],
  providers: [Webhooks, WebhookDelivery],
  exports: [Webhooks],
})
export class WebhooksModule {
  static forRoot(config: WebhooksConfig): DynamicModule {
    return {
      module: WebhooksModule,
      providers: [{ provide: webhooksConfig, useValue: config }],
      exports: [Webhooks],
    };
  }
}
