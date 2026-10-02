import { Controller, Get, Headers, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import {
  ApiErrorSchema,
  FileBreadcrumbsSchema,
  FileEntryIdSchema,
  FileEntryResponseSchema,
  FileListQuerySchema,
  FileOperationIdSchema,
  FileOperationResponseSchema,
  FilePageSchema,
  FileVersionsSchema,
  FileWorkspaceSchema,
  OrganizationIdSchema,
  type FileBreadcrumbs,
  type FileEntryResponse,
  type FileListQuery,
  type FileOperationResponse,
  type FilePage,
  type FileVersions,
  type FileWorkspace,
} from '@workspace/contracts';
import type { TenantContext } from '@workspace/database/tenant';
import {
  CurrentTenant,
  RequireTenant,
  RequireTenantAny,
} from '../tenancy/tenant.guard';
import { Files } from './files';

@ApiTags('files')
@Controller('organizations/:organizationId/files')
@ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 404, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 409, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 503, standardSchema: ApiErrorSchema })
export class FilesController {
  constructor(private readonly files: Files) {}

  @Get('workspace')
  @RequireTenant({ file: ['read'], folder: ['read'] })
  @ApiOperation({ operationId: 'getFileWorkspace' })
  @ApiResponse({ status: 200, standardSchema: FileWorkspaceSchema })
  workspace(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @CurrentTenant() context: TenantContext,
  ): Promise<FileWorkspace> {
    return this.files.workspace(context);
  }

  @Get()
  @RequireTenant({ file: ['read'], folder: ['read'] })
  @ApiOperation({ operationId: 'listFileEntries' })
  @ApiResponse({ status: 200, standardSchema: FilePageSchema })
  list(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Query({ schema: FileListQuerySchema }) query: FileListQuery,
    @CurrentTenant() context: TenantContext,
  ): Promise<FilePage> {
    return this.files.list(context, query);
  }

  @Get('folders/:folderId/breadcrumbs')
  @RequireTenant({ folder: ['read'] })
  @ApiOperation({ operationId: 'getFileBreadcrumbs' })
  @ApiResponse({ status: 200, standardSchema: FileBreadcrumbsSchema })
  breadcrumbs(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Param('folderId', { schema: FileEntryIdSchema }) id: string,
    @CurrentTenant() context: TenantContext,
  ): Promise<FileBreadcrumbs> {
    return this.files.breadcrumbs(context, id);
  }

  @Get('entries/:entryId')
  @RequireTenantAny({ file: ['read'] }, { folder: ['read'] })
  @ApiOperation({ operationId: 'getFileEntry' })
  @ApiResponse({ status: 200, standardSchema: FileEntryResponseSchema })
  get(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Param('entryId', { schema: FileEntryIdSchema }) id: string,
    @Headers() headers: IncomingHttpHeaders,
    @CurrentTenant() context: TenantContext,
  ): Promise<FileEntryResponse> {
    return this.files.get(context, id, fromNodeHeaders(headers));
  }

  @Get('entries/:entryId/versions')
  @RequireTenant({ file: ['read'] })
  @ApiOperation({ operationId: 'listFileVersions' })
  @ApiResponse({ status: 200, standardSchema: FileVersionsSchema })
  versions(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Param('entryId', { schema: FileEntryIdSchema }) id: string,
    @CurrentTenant() context: TenantContext,
  ): Promise<FileVersions> {
    return this.files.versions(context, id);
  }

  @Get('operations/:operationId')
  @RequireTenant({ file: ['read'], folder: ['read'] })
  @ApiOperation({ operationId: 'getFileOperation' })
  @ApiResponse({ status: 200, standardSchema: FileOperationResponseSchema })
  operation(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Param('operationId', { schema: FileOperationIdSchema }) id: string,
    @CurrentTenant() context: TenantContext,
  ): Promise<FileOperationResponse> {
    return this.files.operation(context, id);
  }
}
