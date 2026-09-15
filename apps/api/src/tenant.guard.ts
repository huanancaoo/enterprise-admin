import {
  applyDecorators,
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request, Response } from 'express';
import type { TenantContext } from '@workspace/database/tenant';
import type { PermissionRequest } from './authorization.service';
import { TenantContextService } from './tenant-context.service';
import { getRequestLanguage } from './request-language';

const tenantPermissions = Symbol('tenantPermissions');
const trustedContext = Symbol('trustedTenantContext');
type TenantRequest = Request & { [trustedContext]?: TenantContext };

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly contexts: TenantContextService,
  ) {}

  async canActivate(execution: ExecutionContext): Promise<boolean> {
    const permissions = this.reflector.getAllAndOverride<PermissionRequest>(
      tenantPermissions,
      [execution.getHandler(), execution.getClass()],
    );
    if (
      !permissions ||
      Object.keys(permissions).length === 0 ||
      Object.values(permissions).some((actions) => actions.length === 0)
    )
      throw new InternalServerErrorException(
        'Tenant permissions must be declared',
      );
    const request = execution.switchToHttp().getRequest<TenantRequest>();
    const response = execution.switchToHttp().getResponse<Response>();
    const organizationId = request.params.organizationId;
    if (typeof organizationId !== 'string')
      throw new InternalServerErrorException(
        'Tenant route must declare organizationId',
      );
    const requestId: unknown = response.locals.requestId;
    if (typeof requestId !== 'string')
      throw new InternalServerErrorException(
        'Request logging middleware is required',
      );
    request[trustedContext] = await this.contexts.resolve(
      fromNodeHeaders(request.headers),
      organizationId,
      permissions,
      requestId,
      getRequestLanguage(response),
    );
    return true;
  }
}

export function RequireTenant(permissions: PermissionRequest) {
  return applyDecorators(
    SetMetadata(tenantPermissions, permissions),
    UseGuards(TenantGuard),
  );
}

export const CurrentTenant = createParamDecorator(
  (_data: unknown, execution: ExecutionContext): TenantContext => {
    const context = execution.switchToHttp().getRequest<TenantRequest>()[
      trustedContext
    ];
    if (!context)
      throw new InternalServerErrorException(
        'TenantGuard must establish the context',
      );
    return context;
  },
);
