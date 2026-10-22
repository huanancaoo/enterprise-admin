import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  Req,
  Headers,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBody,
  ApiConsumes,
  ApiHeader,
  type ApiBodyOptions,
} from '@nestjs/swagger';
import {
  ApiErrorSchema,
  PlatformFileWorkspaceSchema,
  PlatformFilePageSchema,
  PlatformFileBreadcrumbsSchema,
  PlatformFileEntrySchema,
  CreateFolderSchema,
  FileOperationResponseSchema,
  FileListQuerySchema,
  FileEntryIdSchema,
  FileOperationIdSchema,
  RenameFileEntrySchema,
  MoveFileEntrySchema,
  TrashFileEntrySchema,
  RestoreFileEntrySchema,
  PurgeFileEntrySchema,
  type RenameFileEntry,
  type MoveFileEntry,
  type TrashFileEntry,
  type RestoreFileEntry,
  type PurgeFileEntry,
  FileUsageResponseSchema,
  UpdatePlatformFilePolicySchema,
  FileEntryImpactQuerySchema,
  FileEntryImpactSchema,
  PlatformFileReferencesSchema,
  ExecuteFileBatchSchema,
  FileBatchResponseSchema,
  FileBatchIdSchema,
  type UpdatePlatformFilePolicy,
  type FileEntryImpactQuery,
  type ExecuteFileBatch,
  FileVersionsSchema,
  UploadFileBodySchema,
  OverwriteFileBodySchema,
  FileContentQuerySchema,
  FileVersionIdSchema,
  type FileContentQuery,
  type CreateFolder,
  type FileListQuery,
} from '@workspace/contracts';
import type { Request, Response } from 'express';
import { CurrentPlatform, RequirePlatform } from '../platform/platform.guard';
import type { PlatformPrincipal } from '../platform/platform-access.service';
import { PlatformFiles } from './platform-files';
import { readFileUpload, readFileOverwrite } from '../files/file-upload-stream';
import { streamFileContent } from '../files/file-content-response';
import { FileRangeError } from '../files/file-content';

@ApiTags('platform-files')
@Controller('platform/files')
@RequirePlatform()
@ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 503, standardSchema: ApiErrorSchema })
export class PlatformFilesController {
  constructor(private readonly files: PlatformFiles) {}

  @Post('folders')
  @HttpCode(200)
  @ApiOperation({ operationId: 'createPlatformFileFolder' })
  @ApiResponse({ status: 200, standardSchema: FileOperationResponseSchema })
  createFolder(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Body({ schema: CreateFolderSchema }) input: CreateFolder,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.files.createFolder(
      actor,
      input,
      response.locals.requestId as string,
    );
  }

  @Get()
  @ApiOperation({ operationId: 'listPlatformFileEntries' })
  @ApiResponse({ status: 200, standardSchema: PlatformFilePageSchema })
  list(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Query({ schema: FileListQuerySchema }) input: FileListQuery,
  ) {
    return this.files.list(actor, input);
  }

  @Get('entries/:entryId')
  @ApiOperation({ operationId: 'getPlatformFileEntry' })
  @ApiResponse({ status: 200, standardSchema: PlatformFileEntrySchema })
  get(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('entryId', { schema: FileEntryIdSchema }) id: string,
  ) {
    return this.files.get(actor, id);
  }

  @Get('folders/:folderId/breadcrumbs')
  @ApiOperation({ operationId: 'getPlatformFileBreadcrumbs' })
  @ApiResponse({ status: 200, standardSchema: PlatformFileBreadcrumbsSchema })
  breadcrumbs(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('folderId', { schema: FileEntryIdSchema }) id: string,
  ) {
    return this.files.breadcrumbs(actor, id);
  }

  @Get('operations/:operationId')
  @ApiOperation({ operationId: 'getPlatformFileOperation' })
  @ApiResponse({ status: 200, standardSchema: FileOperationResponseSchema })
  operation(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('operationId', { schema: FileOperationIdSchema }) id: string,
  ) {
    return this.files.operation(actor, id);
  }

  @Post('uploads')
  @HttpCode(200)
  @ApiOperation({ operationId: 'uploadPlatformFile' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    required: true,
    schema: UploadFileBodySchema.toJSONSchema({
      io: 'input',
      target: 'openapi-3.0',
      override: ({ zodSchema, jsonSchema }) => {
        if (zodSchema._zod.def.type === 'file')
          delete jsonSchema.contentEncoding;
      },
    }) as Extract<ApiBodyOptions, { schema: unknown }>['schema'],
  })
  @ApiResponse({ status: 200, standardSchema: FileOperationResponseSchema })
  upload(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return readFileUpload(request, response, (upload) =>
      this.files.upload(actor, upload, response.locals.requestId as string),
    );
  }

  @Post('entries/:entryId/versions')
  @HttpCode(200)
  @ApiOperation({ operationId: 'overwritePlatformFile' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    required: true,
    schema: OverwriteFileBodySchema.toJSONSchema({
      io: 'input',
      target: 'openapi-3.0',
      override: ({ zodSchema, jsonSchema }) => {
        if (zodSchema._zod.def.type === 'file')
          delete jsonSchema.contentEncoding;
      },
    }) as Extract<ApiBodyOptions, { schema: unknown }>['schema'],
  })
  @ApiResponse({ status: 200, standardSchema: FileOperationResponseSchema })
  overwrite(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('entryId', { schema: FileEntryIdSchema }) id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return readFileOverwrite(request, response, (upload) =>
      this.files.overwrite(
        actor,
        id,
        upload,
        response.locals.requestId as string,
      ),
    );
  }

  @Get('entries/:entryId/versions')
  @ApiOperation({ operationId: 'listPlatformFileVersions' })
  @ApiResponse({ status: 200, standardSchema: FileVersionsSchema })
  versions(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('entryId', { schema: FileEntryIdSchema }) id: string,
  ) {
    return this.files.versions(actor, id);
  }

  @Get('entries/:entryId/versions/:versionId/content')
  @ApiOperation({ operationId: 'getPlatformFileVersionContent' })
  @ApiHeader({ name: 'Range', required: false, schema: { type: 'string' } })
  @ApiResponse({
    status: 200,
    description: 'Original file version bytes',
    content: {
      'application/octet-stream': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  async content(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('entryId', { schema: FileEntryIdSchema }) id: string,
    @Param('versionId', { schema: FileVersionIdSchema }) versionId: string,
    @Query({ schema: FileContentQuerySchema }) query: FileContentQuery,
    @Headers('range') range: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    try {
      return streamFileContent(
        await this.files.content(
          actor,
          id,
          versionId,
          range,
          query.disposition,
        ),
        response,
      );
    } catch (error) {
      if (error instanceof FileRangeError)
        response.setHeader('Content-Range', `bytes */${error.totalBytes}`);
      throw error;
    }
  }

  @Post('entries/:entryId/rename')
  @HttpCode(200)
  @ApiOperation({ operationId: 'renamePlatformFileEntry' })
  @ApiResponse({ status: 200, standardSchema: FileOperationResponseSchema })
  rename(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('entryId', { schema: FileEntryIdSchema }) id: string,
    @Body({ schema: RenameFileEntrySchema }) input: RenameFileEntry,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.files.execute(
      actor,
      'rename',
      { ...input, entryId: id },
      response.locals.requestId as string,
    );
  }

  @Post('entries/:entryId/move')
  @HttpCode(200)
  @ApiOperation({ operationId: 'movePlatformFileEntry' })
  @ApiResponse({ status: 200, standardSchema: FileOperationResponseSchema })
  move(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('entryId', { schema: FileEntryIdSchema }) id: string,
    @Body({ schema: MoveFileEntrySchema }) input: MoveFileEntry,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.files.execute(
      actor,
      'move',
      { ...input, entryId: id },
      response.locals.requestId as string,
    );
  }

  @Post('entries/:entryId/trash')
  @HttpCode(200)
  @ApiOperation({ operationId: 'trashPlatformFileEntry' })
  @ApiResponse({ status: 200, standardSchema: FileOperationResponseSchema })
  trash(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('entryId', { schema: FileEntryIdSchema }) id: string,
    @Body({ schema: TrashFileEntrySchema }) input: TrashFileEntry,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.files.execute(
      actor,
      'trash',
      { ...input, entryId: id },
      response.locals.requestId as string,
    );
  }

  @Post('entries/:entryId/restore')
  @HttpCode(200)
  @ApiOperation({ operationId: 'restorePlatformFileEntry' })
  @ApiResponse({ status: 200, standardSchema: FileOperationResponseSchema })
  restore(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('entryId', { schema: FileEntryIdSchema }) id: string,
    @Body({ schema: RestoreFileEntrySchema }) input: RestoreFileEntry,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.files.execute(
      actor,
      'restore',
      { ...input, entryId: id },
      response.locals.requestId as string,
    );
  }

  @Post('entries/:entryId/purge')
  @HttpCode(200)
  @ApiOperation({ operationId: 'purgePlatformFileEntry' })
  @ApiResponse({ status: 200, standardSchema: FileOperationResponseSchema })
  purge(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('entryId', { schema: FileEntryIdSchema }) id: string,
    @Body({ schema: PurgeFileEntrySchema }) input: PurgeFileEntry,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.files.execute(
      actor,
      'purge',
      { ...input, entryId: id },
      response.locals.requestId as string,
    );
  }

  @Get('policy')
  @ApiOperation({ operationId: 'getPlatformFilePolicy' })
  @ApiResponse({ status: 200, standardSchema: FileUsageResponseSchema })
  policy(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.files.policy(actor, null, response.locals.requestId as string);
  }

  @Post('policy')
  @HttpCode(200)
  @ApiOperation({ operationId: 'updatePlatformFilePolicy' })
  @ApiResponse({ status: 200, standardSchema: FileUsageResponseSchema })
  updatePolicy(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Body({ schema: UpdatePlatformFilePolicySchema })
    input: UpdatePlatformFilePolicy,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.files.policy(actor, input, response.locals.requestId as string);
  }

  @Get('entries/:entryId/impact')
  @ApiOperation({ operationId: 'getPlatformFileEntryImpact' })
  @ApiResponse({ status: 200, standardSchema: FileEntryImpactSchema })
  impact(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('entryId', { schema: FileEntryIdSchema }) id: string,
    @Query({ schema: FileEntryImpactQuerySchema }) query: FileEntryImpactQuery,
  ) {
    return this.files.impact(actor, id, query.action);
  }

  @Get('entries/:entryId/references')
  @ApiOperation({ operationId: 'getPlatformFileReferences' })
  @ApiResponse({ status: 200, standardSchema: PlatformFileReferencesSchema })
  references(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('entryId', { schema: FileEntryIdSchema }) id: string,
  ) {
    return this.files.references(actor, id);
  }

  @Post('batches')
  @HttpCode(200)
  @ApiOperation({ operationId: 'executePlatformFileBatch' })
  @ApiResponse({ status: 200, standardSchema: FileBatchResponseSchema })
  executeBatch(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Body({ schema: ExecuteFileBatchSchema }) input: ExecuteFileBatch,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.files.executeBatch(
      actor,
      input,
      response.locals.requestId as string,
    );
  }

  @Get('batches/:batchId')
  @ApiOperation({ operationId: 'getPlatformFileBatch' })
  @ApiResponse({ status: 200, standardSchema: FileBatchResponseSchema })
  batch(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('batchId', { schema: FileBatchIdSchema }) id: string,
  ) {
    return this.files.batch(actor, id);
  }

  @Get('workspace')
  @ApiOperation({ operationId: 'getPlatformFileWorkspace' })
  @ApiResponse({ status: 200, standardSchema: PlatformFileWorkspaceSchema })
  workspace(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.files.workspace(actor, response.locals.requestId as string);
  }
}
