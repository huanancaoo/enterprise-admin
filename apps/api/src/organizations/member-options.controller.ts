import { rethrowTaskAuthorizationError } from '../tenancy/task-authorization-error';
import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  OrganizationMemberOptionsQuerySchema,
  OrganizationMemberOptionsPageSchema,
  type OrganizationMemberOptionsQuery,
} from '@workspace/contracts';
import { createTaskTenantRunner } from '@workspace/database/task-tenant';
import type { TenantContext } from '@workspace/database/tenant';
import { organizationExchangeRepository } from '@workspace/database/repositories/organization-exchange';
import { CurrentTenant, RequireTenant } from '../tenancy/tenant.guard';
import { AuthRuntime } from '../identity/auth-runtime';

@Injectable()
@ApiTags('organizations')
@ApiParam({
  name: 'organizationId',
  required: true,
  schema: { type: 'string', format: 'uuid' },
})
@Controller('organizations/:organizationId/member-options')
export class OrganizationMemberOptionsController {
  constructor(private readonly runtime: AuthRuntime) {}
  @Get()
  @RequireTenant({ audit: ['read'] })
  @ApiOperation({ operationId: 'listOrganizationMemberOptions' })
  @ApiResponse({
    status: 200,
    standardSchema: OrganizationMemberOptionsPageSchema,
  })
  async list(
    @CurrentTenant() context: TenantContext,
    @Query({ schema: OrganizationMemberOptionsQuerySchema })
    query: OrganizationMemberOptionsQuery,
  ) {
    return createTaskTenantRunner(this.runtime.pool)(
      {
        organizationId: context.organizationId,
        actorId: context.userId,
        resourceId: context.organizationId,
        locale: context.locale,
        requestId: context.requestId,
      },
      { audit: ['read'] },
      (tx) => organizationExchangeRepository.options(tx, query),
    ).catch(rethrowTaskAuthorizationError);
  }
}
