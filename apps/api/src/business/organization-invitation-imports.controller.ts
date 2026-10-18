import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Res,
  Req,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response, Request } from 'express';
import {
  BusinessTaskSchema,
  CreateOrganizationInvitationImportSchema,
  type CreateOrganizationInvitationImport,
} from '@workspace/contracts';
import type { TenantContext } from '@workspace/database/tenant';
import { invitationImportTemplate } from '@workspace/jobs/invitation-import-workbook';
import { CurrentTenant, RequireTenant } from '../tenancy/tenant.guard';
import { BusinessTasks } from './business-tasks';

@ApiTags('Business tasks')
@ApiParam({
  name: 'organizationId',
  required: true,
  schema: { type: 'string', format: 'uuid' },
})
@Controller('organizations/:organizationId/invitations')
export class OrganizationInvitationImportsController {
  constructor(private readonly tasks: BusinessTasks) {}

  @Get('import-template')
  @RequireTenant({ invitation: ['create'] })
  @ApiOperation({ operationId: 'getOrganizationInvitationImportTemplate' })
  @ApiResponse({ status: 200, schema: { type: 'string', format: 'binary' } })
  async template(@Res({ passthrough: true }) response: Response) {
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="organization-invitations.xlsx"',
    );
    response.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(await invitationImportTemplate());
  }

  @Post('imports')
  @HttpCode(202)
  @RequireTenant({ invitation: ['create'] })
  @ApiOperation({ operationId: 'createOrganizationInvitationImport' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string' },
  })
  @ApiResponse({ status: 202, standardSchema: BusinessTaskSchema })
  create(
    @CurrentTenant() context: TenantContext,
    @Body({ schema: CreateOrganizationInvitationImportSchema })
    input: CreateOrganizationInvitationImport,
    @Headers('idempotency-key') key: string,
    @Req() request: Request,
  ) {
    return this.tasks.importInvitations(context, input, key, request.ip);
  }
}
