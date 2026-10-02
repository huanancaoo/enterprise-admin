import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiConsumes,
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiErrorSchema,
  PersonalAvatarResultSchema,
  PersonalMediaContentQuerySchema,
  PersonalMediaIdSchema,
  PersonalMediaUploadKeySchema,
  PersonalMediaUploadResultSchema,
  SetPersonalAvatarSchema,
  type PersonalMediaContentQuery,
  type SetPersonalAvatar,
} from '@workspace/contracts';
import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
import type { Identity } from '../identity/identity.service';
import { measuredContent } from '../files/storage/storage';
import { PersonalMedia } from './personal-media';
import {
  CurrentPersonalIdentity,
  RequirePersonalMedia,
} from './personal-media.guard';
import { readImage } from './image-input';

@ApiTags('personal-media')
@Controller('personal-media')
@RequirePersonalMedia()
export class PersonalMediaController {
  constructor(private readonly media: PersonalMedia) {}

  @Post()
  @ApiOperation({ operationId: 'uploadPersonalMedia' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiConsumes('image/jpeg', 'image/png', 'image/webp', 'image/gif')
  @ApiBody({ required: true, schema: { type: 'string', format: 'binary' } })
  @ApiResponse({ status: 201, standardSchema: PersonalMediaUploadResultSchema })
  @ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 404, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 409, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 413, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 503, standardSchema: ApiErrorSchema })
  async upload(
    @Headers('idempotency-key')
    key: string,
    @CurrentPersonalIdentity() identity: Identity,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const parsed = PersonalMediaUploadKeySchema.safeParse(key);
    if (!parsed.success) throw new BadRequestException();
    const controller = new AbortController();
    const abort = () =>
      controller.abort(new Error('PERSONAL_MEDIA_REQUEST_ABORTED'));
    request.once('aborted', abort);
    response.once('close', abort);
    try {
      const image = await readImage(request, controller.signal);
      return await this.media.upload(
        identity,
        key,
        image,
        response.locals.requestId as string,
        controller.signal,
      );
    } finally {
      request.removeListener('aborted', abort);
      response.removeListener('close', abort);
    }
  }

  @Put('avatar')
  @ApiOperation({ operationId: 'setPersonalAvatar' })
  @ApiResponse({ status: 200, standardSchema: PersonalAvatarResultSchema })
  @ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 404, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 409, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 503, standardSchema: ApiErrorSchema })
  setAvatar(
    @Body({ schema: SetPersonalAvatarSchema }) input: SetPersonalAvatar,
    @CurrentPersonalIdentity() identity: Identity,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.media.setAvatar(
      identity,
      input,
      response.locals.requestId as string,
    );
  }

  @Get(':mediaId/content')
  @ApiOperation({ operationId: 'getPersonalMediaContent' })
  @ApiResponse({
    status: 200,
    content: {
      'application/octet-stream': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 404, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 503, standardSchema: ApiErrorSchema })
  async content(
    @Param('mediaId', { schema: PersonalMediaIdSchema }) mediaId: string,
    @Query({ schema: PersonalMediaContentQuerySchema })
    query: PersonalMediaContentQuery,
    @CurrentPersonalIdentity() identity: Identity,
    @Res({ passthrough: true }) response: Response,
  ) {
    const controller = new AbortController();
    const abort = () =>
      controller.abort(new Error('PERSONAL_MEDIA_REQUEST_ABORTED'));
    response.once('close', abort);
    let opened: Awaited<ReturnType<PersonalMedia['open']>>;
    try {
      opened = await this.media.open(
        identity,
        mediaId,
        query.organizationId,
        controller.signal,
      );
    } catch (error) {
      response.removeListener('close', abort);
      throw error;
    }
    const { media, read } = opened;
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const stream = Readable.from(measuredContent(read.body, read.bytes).stream);
    response.once('close', () => {
      stream.destroy();
      read.body.destroy();
    });
    stream.once('close', () => read.body.destroy());
    if (response.destroyed) {
      stream.destroy();
      read.body.destroy();
    }
    return new StreamableFile(stream, {
      type: media.content_type,
      length: read.bytes,
      disposition: 'inline',
    }).setErrorHandler(() => {
      response.destroy();
      read.body.destroy();
    });
  }
}
