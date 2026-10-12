import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ApiErrorSchema,
  CreateWebhookSchema,
  CreatedWebhookSchema,
  WebhookListSchema,
  WebhookSchema,
  UpdateWebhookSchema,
  WebhookDeliveryPageSchema,
  CapabilityPageQuerySchema,
  type UpdateWebhook,
  type CapabilityPageQuery,
  type CreateWebhook,
} from '@workspace/contracts';
import type { TenantContext } from '@workspace/database/tenant';
import { CurrentTenant, RequireTenant } from '../tenancy/tenant.guard';
import { Webhooks } from './webhooks';

@ApiTags('webhooks')
@ApiParam({
  name: 'organizationId',
  required: true,
  schema: { type: 'string', format: 'uuid' },
})
@Controller('organizations/:organizationId/webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: Webhooks) {}
  @Post()
  @RequireTenant({ integration: ['manage'] })
  @ApiOperation({ operationId: 'createWebhook' })
  @ApiResponse({ status: 201, standardSchema: CreatedWebhookSchema })
  @ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  create(
    @CurrentTenant() context: TenantContext,
    @Body({ schema: CreateWebhookSchema }) input: CreateWebhook,
  ) {
    return this.webhooks.create(context, input);
  }
  @Get()
  @RequireTenant({ integration: ['read'] })
  @ApiOperation({ operationId: 'listWebhooks' })
  @ApiResponse({ status: 200, standardSchema: WebhookListSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  list(@CurrentTenant() context: TenantContext) {
    return this.webhooks.list(context);
  }
  @Put(':webhookId')
  @RequireTenant({ integration: ['manage'] })
  @ApiOperation({ operationId: 'updateWebhook' })
  @ApiResponse({ status: 200, standardSchema: WebhookSchema })
  @ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 404, standardSchema: ApiErrorSchema })
  update(
    @CurrentTenant() context: TenantContext,
    @Param('webhookId', { schema: WebhookSchema.shape.id }) id: string,
    @Body({ schema: UpdateWebhookSchema }) input: UpdateWebhook,
  ) {
    return this.webhooks.update(context, id, input);
  }
  @Delete(':webhookId')
  @HttpCode(204)
  @RequireTenant({ integration: ['manage'] })
  @ApiOperation({ operationId: 'deleteWebhook' })
  @ApiResponse({ status: 204, description: 'Subscription deleted' })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 404, standardSchema: ApiErrorSchema })
  delete(
    @CurrentTenant() context: TenantContext,
    @Param('webhookId', { schema: WebhookSchema.shape.id }) id: string,
  ) {
    return this.webhooks.delete(context, id);
  }
  @Get(':webhookId/deliveries')
  @RequireTenant({ integration: ['read'] })
  @ApiOperation({ operationId: 'listWebhookDeliveries' })
  @ApiResponse({ status: 200, standardSchema: WebhookDeliveryPageSchema })
  @ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 404, standardSchema: ApiErrorSchema })
  deliveries(
    @CurrentTenant() context: TenantContext,
    @Param('webhookId', { schema: WebhookSchema.shape.id }) id: string,
    @Query({ schema: CapabilityPageQuerySchema }) query: CapabilityPageQuery,
  ) {
    return this.webhooks.deliveries(context, id, query);
  }
}
