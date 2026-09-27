import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Res,
} from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import type { Response } from 'express';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ApiErrorSchema,
  MyPreferencesSchema,
  OrganizationIdSchema,
  OrganizationSettingsSchema,
  UpdateMyPreferencesSchema,
  UpdateOrganizationSettingsSchema,
  type MyPreferences,
  type OrganizationSettings,
  type UpdateMyPreferences,
  type UpdateOrganizationSettings,
} from '@workspace/contracts';
import type { TenantContext } from '@workspace/database/tenant';
import { getRequestLanguage } from '../http/request-language';
import { IdentityService } from '../identity/identity.service';
import { CurrentTenant, RequireTenant } from '../tenancy/tenant.guard';
import { LocaleSettings } from './locale-settings';

@ApiTags('locale-settings')
@Controller()
export class LocaleSettingsController {
  constructor(
    private readonly identity: IdentityService,
    private readonly settings: LocaleSettings,
  ) {}

  @Get('me/preferences')
  @ApiOperation({ operationId: 'getMyPreferences' })
  @ApiResponse({ status: 200, standardSchema: MyPreferencesSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  async getMine(
    @Headers() headers: IncomingHttpHeaders,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MyPreferences> {
    const identity = await this.identity.requireIdentity(
      fromNodeHeaders(headers),
    );
    return this.settings.getMyPreferences(
      identity,
      getRequestLanguage(response),
    );
  }

  @Patch('me/preferences')
  @ApiOperation({ operationId: 'updateMyPreferences' })
  @ApiResponse({ status: 200, standardSchema: MyPreferencesSchema })
  @ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 409, standardSchema: ApiErrorSchema })
  async updateMine(
    @Body({ schema: UpdateMyPreferencesSchema }) input: UpdateMyPreferences,
    @Headers() headers: IncomingHttpHeaders,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MyPreferences> {
    const identity = await this.identity.requireIdentity(
      fromNodeHeaders(headers),
    );
    return this.settings.updateMyPreferences(
      identity,
      input,
      getRequestLanguage(response),
    );
  }

  @Get('organizations/:organizationId/settings')
  @RequireTenant({ tenantSettings: ['read'] })
  @ApiOperation({ operationId: 'getOrganizationSettings' })
  @ApiResponse({ status: 200, standardSchema: OrganizationSettingsSchema })
  @ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 404, standardSchema: ApiErrorSchema })
  async getOrganization(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @CurrentTenant() context: TenantContext,
  ): Promise<OrganizationSettings> {
    return this.settings.getOrganizationSettings(context);
  }

  @Patch('organizations/:organizationId/settings')
  @RequireTenant({ tenantSettings: ['update'] })
  @ApiOperation({ operationId: 'updateOrganizationSettings' })
  @ApiResponse({ status: 200, standardSchema: OrganizationSettingsSchema })
  @ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 409, standardSchema: ApiErrorSchema })
  async updateOrganization(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Body({ schema: UpdateOrganizationSettingsSchema })
    input: UpdateOrganizationSettings,
    @Headers() headers: IncomingHttpHeaders,
    @CurrentTenant() context: TenantContext,
  ): Promise<OrganizationSettings> {
    return this.settings.updateOrganizationSettings(
      context,
      input,
      fromNodeHeaders(headers),
    );
  }
}
