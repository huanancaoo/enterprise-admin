import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { APIError } from 'better-auth/api';
import { AuthRuntime } from '../identity/auth-runtime';
import type { PermissionRequest } from '@workspace/permissions';

export type { PermissionRequest } from '@workspace/permissions';

@Injectable()
export class AuthorizationService {
  constructor(private readonly runtime: AuthRuntime) {}

  async requirePermission(
    headers: Headers,
    organizationId: string,
    permissions: PermissionRequest,
  ): Promise<void> {
    // Better Auth 会将空组织 ID 解释为 active organization；业务授权禁止这种隐式目标。
    if (!organizationId)
      throw new BadRequestException('organizationId is required');
    try {
      const result = await this.runtime.auth.api.hasPermission({
        headers,
        body: { organizationId, permissions },
      });
      if (!result.success) throw new ForbiddenException();
    } catch (error) {
      if (error instanceof APIError) {
        if (error.body?.code === 'USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION') {
          throw new ForbiddenException();
        }
        if (error.statusCode === 401) throw new UnauthorizedException();
        if (error.statusCode === 403) throw new ForbiddenException();
      }
      throw error;
    }
  }

  async requireAnyPermission(
    headers: Headers,
    organizationId: string,
    alternatives: readonly PermissionRequest[],
  ): Promise<void> {
    for (const permissions of alternatives) {
      try {
        await this.requirePermission(headers, organizationId, permissions);
        return;
      } catch (error) {
        if (error instanceof ForbiddenException) continue;
        throw error;
      }
    }
    throw new ForbiddenException();
  }
}
