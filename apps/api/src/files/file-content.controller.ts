import {
  Controller,
  Get,
  Headers,
  Param,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ApiErrorSchema,
  FileContentQuerySchema,
  type FileContentQuery,
  FileEntryIdSchema,
  FileVersionIdSchema,
  OrganizationIdSchema,
} from '@workspace/contracts';
import type { TenantContext } from '@workspace/database/tenant';
import type { Response } from 'express';
import { Readable } from 'node:stream';
import { CurrentTenant, RequireTenant } from '../tenancy/tenant.guard';
import { FileContent, FileRangeError } from './file-content';
import { measuredContent } from './storage/storage';

@ApiTags('files')
@Controller('organizations/:organizationId/files/entries')
export class FileContentController {
  constructor(private readonly content: FileContent) {}

  @Get(':fileId/versions/:versionId/content')
  @RequireTenant({ file: ['read'] })
  @ApiOperation({ operationId: 'getFileVersionContent' })
  @ApiHeader({
    name: 'Range',
    required: false,
    schema: { type: 'string' },
    description: 'A single bytes range, including an open end or suffix',
  })
  @ApiResponse({
    status: 200,
    description: 'Original file version bytes',
    content: {
      'application/octet-stream': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({
    status: 206,
    description: 'Original bytes in the selected range',
    content: {
      'application/octet-stream': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 404, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 409, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 416, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 503, standardSchema: ApiErrorSchema })
  async get(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Param('fileId', { schema: FileEntryIdSchema }) fileId: string,
    @Param('versionId', { schema: FileVersionIdSchema }) versionId: string,
    @Query({ schema: FileContentQuerySchema }) query: FileContentQuery,
    @Headers('range') range: string | undefined,
    @CurrentTenant() context: TenantContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    let result: Awaited<ReturnType<FileContent['open']>>;
    try {
      result = await this.content.open(
        context,
        fileId,
        versionId,
        range,
        query.disposition,
      );
    } catch (error) {
      if (error instanceof FileRangeError)
        response.setHeader('Content-Range', `bytes */${error.totalBytes}`);
      throw error;
    }
    const { version, read, dispositionHeader } = result;
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Accept-Ranges', 'bytes');
    if (read.range) {
      response.status(206);
      response.setHeader(
        'Content-Range',
        `bytes ${read.range.start}-${read.range.end}/${read.totalBytes}`,
      );
    }
    const stream = Readable.from(measuredContent(read.body, read.bytes).stream);
    response.once('close', () => {
      stream.destroy();
      read.body.destroy();
    });
    stream.once('close', () => read.body.destroy());
    // open 等待期间也可能已断连；close 事件不会为后注册的监听器重放。
    if (response.destroyed) {
      stream.destroy();
      read.body.destroy();
    }
    return new StreamableFile(stream, {
      type: version.contentType,
      length: read.bytes,
      disposition: dispositionHeader,
    }).setErrorHandler(() => {
      // 响应开始后只能断开连接；JSON 错误或正常结束会把截断内容伪装成成功。
      response.destroy();
      read.body.destroy();
    });
  }
}
