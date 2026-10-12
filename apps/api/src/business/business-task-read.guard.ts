import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request, Response } from 'express';
import type { TenantContext } from '@workspace/database/tenant';
import { getRequestLanguage } from '../http/request-language';
import { TenantContextService } from '../tenancy/tenant-context.service';

const trustedTaskContext = Symbol('trustedBusinessTaskContext');
type TaskRequest = Request & { [trustedTaskContext]?: TenantContext };

@Injectable()
export class BusinessTaskReadGuard implements CanActivate {
  constructor(private readonly contexts: TenantContextService) {}

  async canActivate(execution: ExecutionContext): Promise<boolean> {
    const request = execution.switchToHttp().getRequest<TaskRequest>();
    const response = execution.switchToHttp().getResponse<Response>();
    const organizationId = request.params.organizationId;
    const requestId: unknown = response.locals.requestId;
    if (typeof organizationId !== 'string' || typeof requestId !== 'string')
      throw new InternalServerErrorException('Task route context is required');
    // 单任务的权限取决于已持久化的任务类型，聚合成员入口仍由 Cookie-only TenantGuard 管理。
    request[trustedTaskContext] = await this.contexts.resolveMembership(
      fromNodeHeaders(request.headers),
      organizationId,
      requestId,
      getRequestLanguage(response),
      'business',
    );
    return true;
  }
}

export const CurrentBusinessTaskTenant = createParamDecorator(
  (_data: unknown, execution: ExecutionContext): TenantContext => {
    const context = execution.switchToHttp().getRequest<TaskRequest>()[
      trustedTaskContext
    ];
    if (!context)
      throw new InternalServerErrorException('Task read guard is required');
    return context;
  },
);
