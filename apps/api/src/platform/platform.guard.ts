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
import { IdentityService, type Identity } from '../identity/identity.service';

const trustedPlatform = Symbol('trustedPlatformIdentity');
type PlatformRequest = Request & { [trustedPlatform]?: Identity };

@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(private readonly identity: IdentityService) {}

  async canActivate(execution: ExecutionContext): Promise<boolean> {
    const request = execution.switchToHttp().getRequest<PlatformRequest>();
    const headers = fromNodeHeaders(request.headers);
    const actor = await this.identity.requireIdentity(headers);
    // 每次请求重查任职表；会话、组织角色和打开平台后台都不能代替这一行。
    await this.identity.requirePlatformAssignment(actor);
    request[trustedPlatform] = actor;
    return true;
  }
}

export function RequirePlatform() {
  return applyDecorators(UseGuards(PlatformGuard));
}

export const CurrentPlatform = createParamDecorator(
  (_data: unknown, execution: ExecutionContext): Identity => {
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
