import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import {
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  BusinessTaskSchema,
  CreateAuditExportSchema,
  CreateMemberExportSchema,
  type CreateAuditExport,
  type CreateMemberExport,
} from '@workspace/contracts';
import type { TenantContext } from '@workspace/database/tenant';
import { CurrentTenant, RequireTenant } from '../tenancy/tenant.guard';
import { OrganizationTaskSubmission } from './organization-task-submission';

@ApiTags('Business tasks')
@ApiParam({
  name: 'organizationId',
  required: true,
  schema: { type: 'string', format: 'uuid' },
})
@Controller('organizations/:organizationId')
export class OrganizationExportsController {
  constructor(private readonly tasks: OrganizationTaskSubmission) {}
  @Post('members/exports')
  @HttpCode(202)
  @RequireTenant({ member: ['export'] })
  @ApiOperation({ operationId: 'createOrganizationMemberExport' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string' },
  })
  @ApiResponse({ status: 202, standardSchema: BusinessTaskSchema })
  exportMembers(
    @CurrentTenant() context: TenantContext,
    @Body({ schema: CreateMemberExportSchema }) input: CreateMemberExport,
    @Headers('idempotency-key') key: string,
  ) {
    return this.tasks.exportMembers(context, input, key);
  }

  @Post('audit-events/exports')
  @HttpCode(202)
  @RequireTenant({ audit: ['export'] })
  @ApiOperation({ operationId: 'createOrganizationAuditExport' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string' },
  })
  @ApiResponse({ status: 202, standardSchema: BusinessTaskSchema })
  exportAudit(
    @CurrentTenant() context: TenantContext,
    @Body({ schema: CreateAuditExportSchema }) input: CreateAuditExport,
    @Headers('idempotency-key') key: string,
  ) {
    return this.tasks.exportAudit(context, input, key);
  }
}
