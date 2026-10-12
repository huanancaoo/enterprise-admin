import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ApiErrorSchema,
  CapabilityPageQuerySchema,
  NotificationPageSchema,
  NotificationSchema,
  type CapabilityPageQuery,
  NotificationPreferencesSchema,
} from '@workspace/contracts';
import type { TenantContext } from '@workspace/database/tenant';
import {
  CurrentTenant,
  RequireOrganizationMembership,
} from '../tenancy/tenant.guard';
import { Notifications } from './notifications';

@ApiTags('notifications')
@ApiParam({
  name: 'organizationId',
  required: true,
  schema: { type: 'string', format: 'uuid' },
})
@Controller('organizations/:organizationId')
@RequireOrganizationMembership()
export class NotificationsController {
  constructor(private readonly notifications: Notifications) {}

  @Get('notifications')
  @ApiOperation({ operationId: 'listNotifications' })
  @ApiResponse({ status: 200, standardSchema: NotificationPageSchema })
  @ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  list(
    @CurrentTenant() context: TenantContext,
    @Query({ schema: CapabilityPageQuerySchema }) query: CapabilityPageQuery,
  ) {
    return this.notifications.list(context, query);
  }

  @Post('notifications/:notificationId/read')
  @ApiOperation({ operationId: 'readNotification' })
  @ApiResponse({ status: 201, standardSchema: NotificationSchema })
  @ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 404, standardSchema: ApiErrorSchema })
  read(
    @CurrentTenant() context: TenantContext,
    @Param('notificationId', { schema: NotificationSchema.shape.id })
    id: string,
  ) {
    return this.notifications.read(context, id);
  }

  @Get('notification-preferences')
  @ApiOperation({ operationId: 'getNotificationPreferences' })
  @ApiResponse({ status: 200, standardSchema: NotificationPreferencesSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  preferences(@CurrentTenant() context: TenantContext) {
    return this.notifications.preferences(context);
  }

  @Put('notification-preferences')
  @ApiOperation({ operationId: 'updateNotificationPreferences' })
  @ApiResponse({ status: 200, standardSchema: NotificationPreferencesSchema })
  @ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  updatePreferences(
    @CurrentTenant() context: TenantContext,
    @Body({ schema: NotificationPreferencesSchema })
    input: ReturnType<typeof NotificationPreferencesSchema.parse>,
  ) {
    return this.notifications.updatePreferences(context, input.emailEnabled);
  }
}
