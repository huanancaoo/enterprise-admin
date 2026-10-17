import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  type ApiBodyOptions,
} from '@nestjs/swagger';
import { z } from 'zod';
import type { Request, Response } from 'express';
import {
  AnnouncementDeletedSchema,
  AnnouncementDetailSchema,
  AnnouncementInboxPageSchema,
  AnnouncementInboxQuerySchema,
  AnnouncementMediaQuerySchema,
  AnnouncementMediaUploadSchema,
  AnnouncementAttachmentSchema,
  AnnouncementPageSchema,
  AnnouncementQuerySchema,
  AnnouncementReadersPageSchema,
  AnnouncementReadingSchema,
  AnnouncementReadResultSchema,
  AnnouncementVersionSchema,
  CreateAnnouncementSchema,
  PublishAnnouncementSchema,
  ReadAnnouncementSchema,
  UpdateAnnouncementSchema,
  type AnnouncementInboxQuery,
  type AnnouncementQuery,
  type CreateAnnouncement,
  type UpdateAnnouncement,
} from '@workspace/contracts';
import type { TenantContext } from '@workspace/database/tenant';
import { CurrentPlatform, RequirePlatform } from '../platform/platform.guard';
import type { PlatformPrincipal } from '../platform/platform-access.service';
import {
  CurrentTenant,
  RequireOrganizationMembership,
} from '../tenancy/tenant.guard';
import { Announcements } from './announcements';

const uuid = z.uuid();
const binary = {
  content: {
    'application/octet-stream': {
      schema: { type: 'string', format: 'binary' },
    },
  },
};
function requestId(response: Response) {
  return response.locals.requestId as string;
}

@ApiTags('platform-announcements')
@Controller('platform/announcements')
@RequirePlatform()
export class PlatformAnnouncementsController {
  constructor(private readonly announcements: Announcements) {}

  @Get()
  @ApiOperation({ operationId: 'listPlatformAnnouncements' })
  @ApiResponse({ status: 200, standardSchema: AnnouncementPageSchema })
  list(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Query({ schema: AnnouncementQuerySchema }) query: AnnouncementQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.announcements.manage(
      actor,
      'list',
      null,
      query,
      requestId(response),
    );
  }

  @Post('media')
  @ApiOperation({ operationId: 'uploadPlatformAnnouncementMedia' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    required: true,
    schema: AnnouncementMediaUploadSchema.toJSONSchema({
      io: 'input',
      target: 'openapi-3.0',
      override: ({ zodSchema, jsonSchema }) => {
        if (zodSchema._zod.def.type === 'file')
          delete jsonSchema.contentEncoding;
      },
    }) as Extract<ApiBodyOptions, { schema: unknown }>['schema'],
  })
  @ApiResponse({ status: 201, standardSchema: AnnouncementAttachmentSchema })
  upload(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.announcements.upload(actor, request, requestId(response));
  }

  @Get('media/:mediaId')
  @ApiOperation({ operationId: 'getPlatformAnnouncementMedia' })
  @ApiResponse({ status: 200, ...binary })
  async media(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('mediaId', { schema: uuid }) id: string,
    @Query({ schema: AnnouncementMediaQuerySchema })
    query: { versionId: string },
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    return this.announcements.media(
      actor,
      null,
      id,
      query.versionId,
      response,
      true,
    );
  }

  @Post()
  @ApiOperation({ operationId: 'createPlatformAnnouncement' })
  @ApiResponse({ status: 201, standardSchema: AnnouncementDetailSchema })
  create(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Body({ schema: CreateAnnouncementSchema }) input: CreateAnnouncement,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.announcements.manage(
      actor,
      'create',
      null,
      input,
      requestId(response),
    );
  }

  @Get(':announcementId')
  @ApiOperation({ operationId: 'getPlatformAnnouncement' })
  @ApiResponse({ status: 200, standardSchema: AnnouncementDetailSchema })
  get(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('announcementId', { schema: uuid }) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.announcements.manage(actor, 'get', id, {}, requestId(response));
  }

  @Put(':announcementId')
  @ApiOperation({ operationId: 'updatePlatformAnnouncement' })
  @ApiResponse({ status: 200, standardSchema: AnnouncementDetailSchema })
  update(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('announcementId', { schema: uuid }) id: string,
    @Body({ schema: UpdateAnnouncementSchema }) input: UpdateAnnouncement,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.announcements.manage(
      actor,
      'update',
      id,
      input,
      requestId(response),
    );
  }

  @Post(':announcementId/publish')
  @ApiOperation({ operationId: 'publishPlatformAnnouncement' })
  @ApiResponse({ status: 201, standardSchema: AnnouncementDetailSchema })
  publish(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('announcementId', { schema: uuid }) id: string,
    @Body({ schema: PublishAnnouncementSchema })
    input: z.infer<typeof PublishAnnouncementSchema>,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.announcements.manage(
      actor,
      'publish',
      id,
      input,
      requestId(response),
    );
  }

  @Post(':announcementId/withdraw')
  @ApiOperation({ operationId: 'withdrawPlatformAnnouncement' })
  @ApiResponse({ status: 201, standardSchema: AnnouncementDetailSchema })
  withdraw(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('announcementId', { schema: uuid }) id: string,
    @Body({ schema: AnnouncementVersionSchema })
    input: z.infer<typeof AnnouncementVersionSchema>,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.announcements.manage(
      actor,
      'withdraw',
      id,
      input,
      requestId(response),
    );
  }

  @Delete(':announcementId')
  @ApiOperation({ operationId: 'deletePlatformAnnouncement' })
  @ApiResponse({ status: 200, standardSchema: AnnouncementDeletedSchema })
  remove(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('announcementId', { schema: uuid }) id: string,
    @Body({ schema: AnnouncementVersionSchema })
    input: z.infer<typeof AnnouncementVersionSchema>,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.announcements.manage(
      actor,
      'delete',
      id,
      input,
      requestId(response),
    );
  }

  @Get(':announcementId/readers')
  @ApiOperation({ operationId: 'listPlatformAnnouncementReaders' })
  @ApiResponse({ status: 200, standardSchema: AnnouncementReadersPageSchema })
  readers(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('announcementId', { schema: uuid }) id: string,
    @Query({
      schema: AnnouncementQuerySchema.pick({ page: true, pageSize: true }),
    })
    query: { page: number; pageSize: number },
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.announcements.manage(
      actor,
      'readers',
      id,
      query,
      requestId(response),
    );
  }
}

@ApiTags('platform-announcement-inbox')
@Controller('platform/announcement-inbox')
@RequirePlatform()
export class PlatformAnnouncementInboxController {
  constructor(private readonly announcements: Announcements) {}

  @Get()
  @ApiOperation({ operationId: 'listPlatformAnnouncementInbox' })
  @ApiResponse({ status: 200, standardSchema: AnnouncementInboxPageSchema })
  list(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Query({ schema: AnnouncementInboxQuerySchema })
    query: AnnouncementInboxQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.announcements.inbox(
      actor,
      null,
      'list',
      null,
      query,
      requestId(response),
    );
  }

  @Get('media/:mediaId')
  @ApiOperation({ operationId: 'getPlatformAnnouncementInboxMedia' })
  @ApiResponse({ status: 200, ...binary })
  media(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('mediaId', { schema: uuid }) id: string,
    @Query({ schema: AnnouncementMediaQuerySchema })
    query: { versionId: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.announcements.media(actor, null, id, query.versionId, response);
  }

  @Get(':announcementId')
  @ApiOperation({ operationId: 'getPlatformAnnouncementReading' })
  @ApiResponse({ status: 200, standardSchema: AnnouncementReadingSchema })
  get(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('announcementId', { schema: uuid }) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.announcements.inbox(
      actor,
      null,
      'get',
      id,
      {},
      requestId(response),
    );
  }

  @Post(':announcementId/read')
  @ApiOperation({ operationId: 'readPlatformAnnouncement' })
  @ApiResponse({ status: 201, standardSchema: AnnouncementReadResultSchema })
  read(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('announcementId', { schema: uuid }) id: string,
    @Body({ schema: ReadAnnouncementSchema })
    input: z.infer<typeof ReadAnnouncementSchema>,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.announcements.inbox(
      actor,
      null,
      'read',
      id,
      input,
      requestId(response),
    );
  }
}

@ApiTags('tenant-announcements')
@Controller('organizations/:organizationId/announcements')
@ApiParam({
  name: 'organizationId',
  schema: { type: 'string', format: 'uuid' },
})
@RequireOrganizationMembership()
export class TenantAnnouncementsController {
  constructor(private readonly announcements: Announcements) {}

  @Get()
  @ApiOperation({ operationId: 'listTenantAnnouncements' })
  @ApiResponse({ status: 200, standardSchema: AnnouncementInboxPageSchema })
  list(
    @CurrentTenant() context: TenantContext,
    @Query({ schema: AnnouncementInboxQuerySchema })
    query: AnnouncementInboxQuery,
  ) {
    return this.announcements.tenantInbox(context, 'list', null, query);
  }

  @Get('media/:mediaId')
  @ApiOperation({ operationId: 'getTenantAnnouncementMedia' })
  @ApiResponse({ status: 200, ...binary })
  media(
    @CurrentTenant() context: TenantContext,
    @Param('mediaId', { schema: uuid }) id: string,
    @Query({ schema: AnnouncementMediaQuerySchema })
    query: { versionId: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.announcements.tenantMedia(
      context,
      id,
      query.versionId,
      response,
    );
  }

  @Get(':announcementId')
  @ApiOperation({ operationId: 'getTenantAnnouncement' })
  @ApiResponse({ status: 200, standardSchema: AnnouncementReadingSchema })
  get(
    @CurrentTenant() context: TenantContext,
    @Param('announcementId', { schema: uuid }) id: string,
  ) {
    return this.announcements.tenantInbox(context, 'get', id, {});
  }

  @Post(':announcementId/read')
  @ApiOperation({ operationId: 'readTenantAnnouncement' })
  @ApiResponse({ status: 201, standardSchema: AnnouncementReadResultSchema })
  read(
    @CurrentTenant() context: TenantContext,
    @Param('announcementId', { schema: uuid }) id: string,
    @Body({ schema: ReadAnnouncementSchema })
    input: z.infer<typeof ReadAnnouncementSchema>,
  ) {
    return this.announcements.tenantInbox(context, 'read', id, input);
  }
}
