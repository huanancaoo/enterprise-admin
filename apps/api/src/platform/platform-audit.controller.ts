import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ApiErrorSchema,
  PlatformAuditEventIdSchema,
  PlatformAuditEventSchema,
  PlatformAuditPageSchema,
  PlatformAuditQuerySchema,
  PlatformAuditPurposeSchema,
  type PlatformAuditQuery,
} from '@workspace/contracts';
import { CurrentPlatform, RequirePlatform } from './platform.guard';
import type { PlatformPrincipal } from './platform-access.service';
import { PlatformAudit } from './platform-audit';

@ApiTags('platform-audit')
@Controller('platform/audit-events')
@RequirePlatform()
@ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 503, standardSchema: ApiErrorSchema })
export class PlatformAuditController {
  constructor(private readonly audit: PlatformAudit) {}

  @Get()
  @ApiOperation({ operationId: 'listPlatformAuditEvents' })
  @ApiResponse({ status: 200, standardSchema: PlatformAuditPageSchema })
  list(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Query({ schema: PlatformAuditQuerySchema }) query: PlatformAuditQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.audit.list(actor, query, response.locals.requestId as string);
  }

  @Get(':eventId')
  @ApiOperation({ operationId: 'getPlatformAuditEvent' })
  @ApiResponse({ status: 200, standardSchema: PlatformAuditEventSchema })
  @ApiResponse({ status: 404, standardSchema: ApiErrorSchema })
  get(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('eventId', { schema: PlatformAuditEventIdSchema }) eventId: string,
    @Query({ schema: PlatformAuditPurposeSchema }) query: { purpose: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.audit.get(
      actor,
      eventId,
      query.purpose,
      response.locals.requestId as string,
    );
  }
}
