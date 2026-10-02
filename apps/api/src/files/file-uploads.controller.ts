import {
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
  type ApiBodyOptions,
} from '@nestjs/swagger';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import type { Request, Response } from 'express';
import {
  ApiErrorSchema,
  FileOperationResponseSchema,
  OrganizationIdSchema,
  UploadFileBodySchema,
  OverwriteFileBodySchema,
  FileEntryIdSchema,
} from '@workspace/contracts';
import type { TenantContext } from '@workspace/database/tenant';
import { CurrentTenant, RequireTenant } from '../tenancy/tenant.guard';
import { FileUploads } from './file-uploads';
import { FileOverwrites } from './file-overwrites';
import { readFileUpload, readFileOverwrite } from './file-upload-stream';

@ApiTags('files')
@Controller('organizations/:organizationId/files')
@ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 404, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 409, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 413, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 503, standardSchema: ApiErrorSchema })
export class FileUploadsController {
  constructor(
    private readonly uploads: FileUploads,
    private readonly overwrites: FileOverwrites,
  ) {}

  @Post('uploads')
  @HttpCode(200)
  @RequireTenant({ file: ['upload'] })
  @ApiOperation({ operationId: 'uploadOrganizationFile' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    required: true,
    schema: UploadFileBodySchema.toJSONSchema({
      io: 'input',
      target: 'openapi-3.0',
    }) as Extract<ApiBodyOptions, { schema: unknown }>['schema'],
  })
  @ApiResponse({ status: 200, standardSchema: FileOperationResponseSchema })
  async upload(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Headers() headers: IncomingHttpHeaders,
    @CurrentTenant() context: TenantContext,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const upload = await readFileUpload(request, response);
    try {
      return await this.uploads.upload(
        context,
        fromNodeHeaders(headers),
        upload,
      );
    } finally {
      upload.dispose();
    }
  }

  @Post('entries/:entryId/overwrite')
  @HttpCode(200)
  @RequireTenant({ file: ['upload', 'update'] })
  @ApiOperation({ operationId: 'overwriteOrganizationFile' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    required: true,
    schema: OverwriteFileBodySchema.toJSONSchema({
      io: 'input',
      target: 'openapi-3.0',
    }) as Extract<ApiBodyOptions, { schema: unknown }>['schema'],
  })
  @ApiResponse({ status: 200, standardSchema: FileOperationResponseSchema })
  async overwrite(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Param('entryId', { schema: FileEntryIdSchema }) entryId: string,
    @Headers() headers: IncomingHttpHeaders,
    @CurrentTenant() context: TenantContext,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const upload = await readFileOverwrite(request, response);
    try {
      return await this.overwrites.overwrite(
        context,
        fromNodeHeaders(headers),
        entryId,
        upload,
      );
    } finally {
      upload.dispose();
    }
  }
}
