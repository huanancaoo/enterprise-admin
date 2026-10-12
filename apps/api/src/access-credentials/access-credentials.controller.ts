import {
  Body,
  Controller,
  Headers,
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Param,
  Post,
  Get,
  Query,
  Delete,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import {
  CreateAccessCredentialSchema,
  IssuedAccessCredentialSchema,
  AccessCredentialListSchema,
  AccessCredentialListQuerySchema,
  type AccessCredentialListQuery,
  OrganizationIdSchema,
  AccessCredentialIdSchema,
  type CreateAccessCredential,
} from '@workspace/contracts';
import type { TenantContext } from '@workspace/database/tenant';
import {
  CurrentTenant,
  RequireTenant,
  RequireTenantAny,
} from '../tenancy/tenant.guard';
import { IdentityService } from '../identity/identity.service';
import { AuthRuntime } from '../identity/auth-runtime';
import { AccessCredentials } from './access-credentials';

@Injectable()
export class CookieCredentialManagementGuard implements CanActivate {
  constructor(
    private readonly identity: IdentityService,
    private readonly runtime: AuthRuntime,
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<{ headers: IncomingHttpHeaders; method: string }>();
    if (request.headers['x-api-key']) throw new UnauthorizedException();
    await this.identity.requireIdentity(fromNodeHeaders(request.headers));
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      (!request.headers.origin ||
        !this.runtime.trustedOrigins.includes(request.headers.origin))
    )
      throw new ForbiddenException();
    return true;
  }
}

@ApiTags('access-credentials')
@Controller('organizations/:organizationId/access-credentials')
@UseGuards(CookieCredentialManagementGuard)
export class AccessCredentialsController {
  constructor(private readonly credentials: AccessCredentials) {}
  @Post()
  @RequireTenant({ integration: ['manage'] })
  @ApiOperation({ operationId: 'createAccessCredential' })
  @ApiResponse({ status: 201, standardSchema: IssuedAccessCredentialSchema })
  issue(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Headers() headers: IncomingHttpHeaders,
    @Body({ schema: CreateAccessCredentialSchema })
    input: CreateAccessCredential,
    @CurrentTenant() context: TenantContext,
  ) {
    return this.credentials.issue(context, fromNodeHeaders(headers), input);
  }
  @Get()
  @RequireTenantAny({ integration: ['read'] }, { integration: ['manage'] })
  @ApiOperation({ operationId: 'listAccessCredentials' })
  @ApiResponse({ status: 200, standardSchema: AccessCredentialListSchema })
  list(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @CurrentTenant() context: TenantContext,
    @Query({ schema: AccessCredentialListQuerySchema })
    query: AccessCredentialListQuery,
  ) {
    return this.credentials.list(context, query);
  }

  @Delete(':credentialId')
  @HttpCode(204)
  @RequireTenant({ integration: ['manage'] })
  @ApiOperation({ operationId: 'revokeAccessCredential' })
  @ApiResponse({ status: 204, description: 'Credential revoked' })
  revoke(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Param('credentialId', { schema: AccessCredentialIdSchema })
    credentialId: string,
    @Headers() headers: IncomingHttpHeaders,
    @CurrentTenant() context: TenantContext,
  ) {
    return this.credentials.revoke(
      context,
      fromNodeHeaders(headers),
      credentialId,
    );
  }
}
