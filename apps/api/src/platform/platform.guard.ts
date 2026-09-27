import {
  applyDecorators,
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  HttpException,
  Injectable,
  InternalServerErrorException,
  UseGuards,
} from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request, Response } from 'express';
import type { Identity } from '../identity/identity.service';
import { IdentityService } from '../identity/identity.service';
import {
  PlatformAccessService,
  type PlatformPrincipal,
} from './platform-access.service';

const trustedPlatform = Symbol('trustedPlatformIdentity');
type PlatformRequest = Request & { [trustedPlatform]?: PlatformPrincipal };

@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    private readonly identity: IdentityService,
    private readonly access: PlatformAccessService,
  ) {}

  async canActivate(execution: ExecutionContext): Promise<boolean> {
    const request = execution.switchToHttp().getRequest<PlatformRequest>();
    const headers = fromNodeHeaders(request.headers);
    let actor: Identity | undefined;
    try {
      actor = await this.identity.requireIdentity(headers);
      request[trustedPlatform] = await this.access.requireAccess(
        actor,
        !['GET', 'HEAD', 'OPTIONS'].includes(request.method),
      );
    } catch (error) {
      if (
        error instanceof HttpException &&
        [401, 403].includes(error.getStatus())
      ) {
        const body = error.getResponse();
        const requiresMfa =
          typeof body === 'object' &&
          body !== null &&
          'code' in body &&
          body.code === 'PLATFORM_MFA_REQUIRED';
        const reason =
          error.getStatus() === 401
            ? 'UNAUTHENTICATED'
            : requiresMfa
              ? 'PLATFORM_MFA_REQUIRED'
              : 'FORBIDDEN';
        const response = execution.switchToHttp().getResponse<Response>();
        // 拒绝事件独立提交，否则异常回滚会同时抹去拒绝事实。
        await this.access.recordDenial(
          actor,
          reason,
          response.locals.requestId as string,
        );
      }
      throw error;
    }
    return true;
  }
}

export function RequirePlatform() {
  return applyDecorators(UseGuards(PlatformGuard));
}

export const CurrentPlatform = createParamDecorator(
  (_data: unknown, execution: ExecutionContext): PlatformPrincipal => {
    const identity = execution.switchToHttp().getRequest<PlatformRequest>()[
      trustedPlatform
    ];
    if (!identity)
      throw new InternalServerErrorException(
        'PlatformGuard must establish the identity',
      );
    return identity;
  },
);
