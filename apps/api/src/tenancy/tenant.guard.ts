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
import type { PermissionRequest } from '../authorization/authorization.service';
import { getRequestLanguage } from '../http/request-language';
import { TenantContextService } from './tenant-context.service';

const tenantPermissions = Symbol('tenantPermissions');
const trustedContext = Symbol('trustedTenantContext');
type TenantRequest = Request & { [trustedContext]?: TenantContext };
type TenantPermissionRequirement =
  | PermissionRequest
  | { anyOf: readonly PermissionRequest[] }
  | { membershipOnly: true };

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly contexts: TenantContextService,
  ) {}

  async canActivate(execution: ExecutionContext): Promise<boolean> {
    const requirement =
      this.reflector.getAllAndOverride<TenantPermissionRequirement>(
        tenantPermissions,
        [execution.getHandler(), execution.getClass()],
      );
    if (!requirement || !validRequirement(requirement))
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
    const headers = fromNodeHeaders(request.headers);
    const language = getRequestLanguage(response);
    request[trustedContext] =
      'membershipOnly' in requirement
        ? await this.contexts.resolveMembership(
            headers,
            organizationId,
            requestId,
            language,
          )
        : 'anyOf' in requirement
          ? await this.contexts.resolveAny(
              headers,
              organizationId,
              requirement.anyOf,
              requestId,
              language,
            )
          : await this.contexts.resolve(
              headers,
              organizationId,
              requirement,
              requestId,
              language,
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

export function RequireTenantAny(...alternatives: PermissionRequest[]) {
  return applyDecorators(
    SetMetadata(tenantPermissions, { anyOf: alternatives }),
    UseGuards(TenantGuard),
  );
}

// 本人任务与通知读取属于成员身份能力，不要求成员额外取得目录或项目读取动作。
export function RequireOrganizationMembership() {
  return applyDecorators(
    SetMetadata(tenantPermissions, { membershipOnly: true }),
    UseGuards(TenantGuard),
  );
}

function validRequirement(requirement: TenantPermissionRequirement): boolean {
  if ('membershipOnly' in requirement)
    return requirement.membershipOnly === true;
  const alternatives =
    'anyOf' in requirement ? requirement.anyOf : [requirement];
  return (
    alternatives.length > 0 &&
    alternatives.every(
      (permissions) =>
        Object.keys(permissions).length > 0 &&
        Object.values(permissions).every((actions) => actions.length > 0),
    )
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
