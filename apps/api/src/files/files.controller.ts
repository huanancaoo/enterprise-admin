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
  CreateFolderSchema,
  FileBreadcrumbsSchema,
  FileEntryIdSchema,
  FileEntryResponseSchema,
  FileListQuerySchema,
  FileOperationIdSchema,
  FileOperationResponseSchema,
  FilePageSchema,
  FileVersionsSchema,
  FileWorkspaceSchema,
  FileReferenceLocationsSchema,
  OrganizationIdSchema,
  type FileBreadcrumbs,
  type FileEntryResponse,
  type FileListQuery,
  type FileOperationResponse,
  type FilePage,
  type FileVersions,
  type FileWorkspace,
  type CreateFolder,
  type FileReferenceLocations,
} from '@workspace/contracts';
import type { TenantContext } from '@workspace/database/tenant';
import {
  CurrentTenant,
  RequireTenant,
  RequireTenantAny,
} from '../tenancy/tenant.guard';
import { Files } from './files';
import { FileOperationReads } from './file-operation-reads';
import { FileWrites } from './file-writes';

@ApiTags('files')
@Controller('organizations/:organizationId/files')
@ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 404, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 409, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 503, standardSchema: ApiErrorSchema })
export class FilesController {
  constructor(
    private readonly files: Files,
    private readonly writes: FileWrites,
    private readonly receipts: FileOperationReads,
  ) {}

  @Post('folders')
  @HttpCode(200)
  @RequireTenant({ folder: ['create'] })
  @ApiOperation({ operationId: 'createFileFolder' })
  @ApiResponse({ status: 200, standardSchema: FileOperationResponseSchema })
  createFolder(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Body({ schema: CreateFolderSchema }) input: CreateFolder,
    @Headers() headers: IncomingHttpHeaders,
    @CurrentTenant() context: TenantContext,
  ): Promise<FileOperationResponse> {
    return this.writes.createFolder(context, fromNodeHeaders(headers), input);
  }

  @Get('workspace')
  @RequireTenant({ file: ['read'], folder: ['read'] })
  @ApiOperation({ operationId: 'getFileWorkspace' })
  @ApiResponse({ status: 200, standardSchema: FileWorkspaceSchema })
  workspace(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Headers() headers: IncomingHttpHeaders,
    @CurrentTenant() context: TenantContext,
  ): Promise<FileWorkspace> {
    return this.files.workspace(context, fromNodeHeaders(headers));
  }

  @Get()
  @RequireTenant({ file: ['read'], folder: ['read'] })
  @ApiOperation({ operationId: 'listFileEntries' })
  @ApiResponse({ status: 200, standardSchema: FilePageSchema })
  list(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Query({ schema: FileListQuerySchema }) query: FileListQuery,
    @Headers() headers: IncomingHttpHeaders,
    @CurrentTenant() context: TenantContext,
  ): Promise<FilePage> {
    return this.files.list(context, query, fromNodeHeaders(headers));
  }

  @Get('folders/:folderId/breadcrumbs')
  @RequireTenant({ folder: ['read'] })
  @ApiOperation({ operationId: 'getFileBreadcrumbs' })
  @ApiResponse({ status: 200, standardSchema: FileBreadcrumbsSchema })
  breadcrumbs(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Param('folderId', { schema: FileEntryIdSchema }) id: string,
    @Headers() headers: IncomingHttpHeaders,
    @CurrentTenant() context: TenantContext,
  ): Promise<FileBreadcrumbs> {
    return this.files.breadcrumbs(context, id, fromNodeHeaders(headers));
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
    @Headers() headers: IncomingHttpHeaders,
    @CurrentTenant() context: TenantContext,
  ): Promise<FileVersions> {
    return this.files.versions(context, id, fromNodeHeaders(headers));
  }

  @Get('entries/:entryId/references')
  @RequireTenantAny({ file: ['read'] }, { folder: ['read'] })
  @ApiOperation({ operationId: 'getFileReferenceLocations' })
  @ApiResponse({ status: 200, standardSchema: FileReferenceLocationsSchema })
  references(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Param('entryId', { schema: FileEntryIdSchema }) id: string,
    @Headers() headers: IncomingHttpHeaders,
    @CurrentTenant() context: TenantContext,
  ): Promise<FileReferenceLocations> {
    return this.files.references(context, id, fromNodeHeaders(headers));
  }

  @Get('operations/:operationId')
  @RequireTenantAny(
    { file: ['read'], folder: ['read'] },
    { folder: ['create'] },
    { file: ['upload'] },
    { file: ['update'] },
    { folder: ['update'] },
    { file: ['delete'] },
    { folder: ['delete'] },
    { file: ['restore'] },
    { file: ['purge'] },
  )
  @ApiOperation({ operationId: 'getFileOperation' })
  @ApiResponse({ status: 200, standardSchema: FileOperationResponseSchema })
  operation(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Param('operationId', { schema: FileOperationIdSchema }) id: string,
    @Headers() headers: IncomingHttpHeaders,
    @CurrentTenant() context: TenantContext,
  ): Promise<FileOperationResponse> {
    return this.receipts.operation(context, id, fromNodeHeaders(headers));
  }
}
