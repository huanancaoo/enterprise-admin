import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import {
  ApiErrorSchema,
  ExecuteFileBatchSchema,
  FileBatchIdSchema,
  FileBatchResponseSchema,
  OrganizationIdSchema,
  type ExecuteFileBatch,
  type FileBatchResponse,
} from '@workspace/contracts';
import type { TenantContext } from '@workspace/database/tenant';
import { CurrentTenant, RequireTenantAny } from '../tenancy/tenant.guard';
import { FileBatches } from './file-batches';

@ApiTags('files')
@Controller('organizations/:organizationId/files/batches')
@ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 404, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 409, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 503, standardSchema: ApiErrorSchema })
export class FileBatchesController {
  constructor(private readonly batches: FileBatches) {}
  @Post()
  @HttpCode(200)
  @RequireTenantAny(
    { file: ['update'] },
    { folder: ['update'] },
    { file: ['delete'] },
    { folder: ['delete'] },
    { file: ['restore'] },
    { file: ['purge'] },
  )
  @ApiOperation({ operationId: 'executeFileBatch' })
  @ApiResponse({ status: 200, standardSchema: FileBatchResponseSchema })
  execute(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Body({ schema: ExecuteFileBatchSchema }) input: ExecuteFileBatch,
    @Headers() headers: IncomingHttpHeaders,
    @CurrentTenant() context: TenantContext,
  ): Promise<FileBatchResponse> {
    return this.batches.execute(context, fromNodeHeaders(headers), input);
  }
  @Get(':batchId')
  @RequireTenantAny(
    { file: ['read'], folder: ['read'] },
    { file: ['update'] },
    { folder: ['update'] },
    { file: ['delete'] },
    { folder: ['delete'] },
    { file: ['restore'] },
    { file: ['purge'] },
  )
  @ApiOperation({ operationId: 'getFileBatch' })
  @ApiResponse({ status: 200, standardSchema: FileBatchResponseSchema })
  get(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Param('batchId', { schema: FileBatchIdSchema }) batchId: string,
    @Headers() headers: IncomingHttpHeaders,
    @CurrentTenant() context: TenantContext,
  ): Promise<FileBatchResponse> {
    return this.batches.get(context, fromNodeHeaders(headers), batchId);
  }
}
