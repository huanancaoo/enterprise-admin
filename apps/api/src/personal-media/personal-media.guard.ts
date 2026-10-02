import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  UseGuards,
} from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request, Response } from 'express';
import { AuthRuntime } from '../identity/auth-runtime';
import { IdentityService, type Identity } from '../identity/identity.service';
import { getRequestLanguage } from '../http/request-language';

const personalIdentity = Symbol('personalIdentity');
type PersonalRequest = Request & { [personalIdentity]?: Identity };

@Injectable()
export class PersonalMediaGuard implements CanActivate {
  constructor(
    private readonly identity: IdentityService,
    private readonly runtime: AuthRuntime,
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<PersonalRequest>();
    const identity = await this.identity.requireIdentity(
      fromNodeHeaders(request.headers),
    );
    getRequestLanguage(
      context.switchToHttp().getResponse<Response>(),
    ).useUserPreference(identity.preferredLocale);
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      (!request.headers.origin ||
        !this.runtime.trustedOrigins.includes(request.headers.origin))
    )
      throw new ForbiddenException();
    request[personalIdentity] = identity;
    return true;
  }
}
export const RequirePersonalMedia = () => UseGuards(PersonalMediaGuard);
export const CurrentPersonalIdentity = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Identity => {
    const identity = context.switchToHttp().getRequest<PersonalRequest>()[
      personalIdentity
    ];
    if (!identity)
      throw new InternalServerErrorException(
        'PersonalMediaGuard must establish identity',
      );
    return identity;
  },
);
