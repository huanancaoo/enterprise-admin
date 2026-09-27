import {
  applyDecorators,
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  UseGuards,
} from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';
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
    const actor = await this.identity.requireIdentity(headers);
    request[trustedPlatform] = await this.access.requireAccess(
      actor,
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method),
    );
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
