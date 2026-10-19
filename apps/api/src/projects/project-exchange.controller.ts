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
  CreateProjectExportSchema,
  CreateProjectImportSchema,
  type CreateProjectExport,
  type CreateProjectImport,
} from '@workspace/contracts';
import type { TenantContext } from '@workspace/database/tenant';
import { BusinessTasks } from '../business/business-tasks';
import { CurrentTenant, RequireTenant } from '../tenancy/tenant.guard';

@ApiTags('Business tasks')
@ApiParam({
  name: 'organizationId',
  required: true,
  schema: { type: 'string', format: 'uuid' },
})
@Controller('organizations/:organizationId')
export class ProjectExchangeController {
  constructor(private readonly tasks: BusinessTasks) {}
  @Post('projects/imports')
  @HttpCode(202)
  @RequireTenant({ project: ['create'] })
  @ApiOperation({ operationId: 'createProjectImport' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string' },
  })
  @ApiResponse({ status: 202, standardSchema: BusinessTaskSchema })
  import(
    @CurrentTenant() context: TenantContext,
    @Body({ schema: CreateProjectImportSchema }) input: CreateProjectImport,
    @Headers('idempotency-key') key: string,
  ) {
    return this.tasks.submit(context, input, key, 'projects.import');
  }
  @Post('projects/exports')
  @HttpCode(202)
  @RequireTenant({ project: ['export'] })
  @ApiOperation({ operationId: 'createProjectExport' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string' },
  })
  @ApiResponse({ status: 202, standardSchema: BusinessTaskSchema })
  export(
    @CurrentTenant() context: TenantContext,
    @Body({ schema: CreateProjectExportSchema }) input: CreateProjectExport,
    @Headers('idempotency-key') key: string,
  ) {
    return this.tasks.submit(context, input, key, 'projects.export');
  }
}
