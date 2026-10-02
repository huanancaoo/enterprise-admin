import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import {
  ApiErrorSchema,
  FileEntryIdSchema,
  FileEntryImpactQuerySchema,
  FileEntryImpactSchema,
  FileOperationResponseSchema,
  MoveFileEntrySchema,
  OrganizationIdSchema,
  PurgeFileEntrySchema,
  RenameFileEntrySchema,
  RestoreFileEntrySchema,
  TrashFileEntrySchema,
  type FileEntryImpact,
  type FileEntryImpactQuery,
  type FileOperationResponse,
  type MoveFileEntry,
  type PurgeFileEntry,
  type RenameFileEntry,
  type RestoreFileEntry,
  type TrashFileEntry,
} from '@workspace/contracts';
import type { TenantContext } from '@workspace/database/tenant';
import {
  CurrentTenant,
  RequireTenant,
  RequireTenantAny,
} from '../tenancy/tenant.guard';
import { FilePathWrites } from './file-path-writes';

@ApiTags('files')
@Controller('organizations/:organizationId/files/entries/:entryId')
@ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 404, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 409, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 503, standardSchema: ApiErrorSchema })
export class FilePathsController {
  constructor(private readonly writes: FilePathWrites) {}

  @Get('impact')
  @RequireTenantAny(
    { file: ['delete'] },
    { folder: ['delete'] },
    { file: ['purge'] },
  )
  @ApiOperation({ operationId: 'getFileEntryImpact' })
  @ApiResponse({ status: 200, standardSchema: FileEntryImpactSchema })
  impact(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Param('entryId', { schema: FileEntryIdSchema }) id: string,
    @Query({ schema: FileEntryImpactQuerySchema }) query: FileEntryImpactQuery,
    @Headers() headers: IncomingHttpHeaders,
    @CurrentTenant() context: TenantContext,
  ): Promise<FileEntryImpact> {
    return this.writes.impact(
      context,
      fromNodeHeaders(headers),
      id,
      query.action,
    );
  }

  @Post('rename')
  @HttpCode(200)
  @RequireTenantAny({ file: ['update'] }, { folder: ['update'] })
  @ApiOperation({ operationId: 'renameFileEntry' })
  @ApiResponse({ status: 200, standardSchema: FileOperationResponseSchema })
  rename(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Param('entryId', { schema: FileEntryIdSchema }) id: string,
    @Body({ schema: RenameFileEntrySchema }) input: RenameFileEntry,
    @Headers() headers: IncomingHttpHeaders,
    @CurrentTenant() context: TenantContext,
  ): Promise<FileOperationResponse> {
    return this.writes.perform(
      context,
      fromNodeHeaders(headers),
      id,
      'rename',
      input,
    );
  }

  @Post('move')
  @HttpCode(200)
  @RequireTenantAny({ file: ['update'] }, { folder: ['update'] })
  @ApiOperation({ operationId: 'moveFileEntry' })
  @ApiResponse({ status: 200, standardSchema: FileOperationResponseSchema })
  move(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Param('entryId', { schema: FileEntryIdSchema }) id: string,
    @Body({ schema: MoveFileEntrySchema }) input: MoveFileEntry,
    @Headers() headers: IncomingHttpHeaders,
    @CurrentTenant() context: TenantContext,
  ): Promise<FileOperationResponse> {
    return this.writes.perform(
      context,
      fromNodeHeaders(headers),
      id,
      'move',
      input,
    );
  }

  @Post('trash')
  @HttpCode(200)
  @RequireTenantAny({ file: ['delete'] }, { folder: ['delete'] })
  @ApiOperation({ operationId: 'trashFileEntry' })
  @ApiResponse({ status: 200, standardSchema: FileOperationResponseSchema })
  trash(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Param('entryId', { schema: FileEntryIdSchema }) id: string,
    @Body({ schema: TrashFileEntrySchema }) input: TrashFileEntry,
    @Headers() headers: IncomingHttpHeaders,
    @CurrentTenant() context: TenantContext,
  ): Promise<FileOperationResponse> {
    return this.writes.perform(
      context,
      fromNodeHeaders(headers),
      id,
      'trash',
      input,
    );
  }

  @Post('restore')
  @HttpCode(200)
  @RequireTenant({ file: ['restore'] })
  @ApiOperation({ operationId: 'restoreFileEntry' })
  @ApiResponse({ status: 200, standardSchema: FileOperationResponseSchema })
  restore(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Param('entryId', { schema: FileEntryIdSchema }) id: string,
    @Body({ schema: RestoreFileEntrySchema }) input: RestoreFileEntry,
    @Headers() headers: IncomingHttpHeaders,
    @CurrentTenant() context: TenantContext,
  ): Promise<FileOperationResponse> {
    return this.writes.perform(
      context,
      fromNodeHeaders(headers),
      id,
      'restore',
      input,
    );
  }

  @Post('purge')
  @HttpCode(200)
  @RequireTenant({ file: ['purge'] })
  @ApiOperation({ operationId: 'purgeFileEntry' })
  @ApiResponse({ status: 200, standardSchema: FileOperationResponseSchema })
  purge(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Param('entryId', { schema: FileEntryIdSchema }) id: string,
    @Body({ schema: PurgeFileEntrySchema }) input: PurgeFileEntry,
    @Headers() headers: IncomingHttpHeaders,
    @CurrentTenant() context: TenantContext,
  ): Promise<FileOperationResponse> {
    return this.writes.perform(
      context,
      fromNodeHeaders(headers),
      id,
      'purge',
      input,
    );
  }
}
