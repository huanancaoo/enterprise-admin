import { Inject, Injectable } from '@nestjs/common';
import {
  ApiErrorCodeSchema,
  type ApiErrorCode,
  type PlatformSettings as Settings,
  type UpdatePlatformSettings,
  type PlatformSettingsUpdateResult,
} from '@workspace/contracts';
import { supportedLocales } from '@workspace/i18n';
import { PLATFORM_DEPLOYMENT_SUMMARY } from '../config/deployment-summary';
import type { DeploymentSummary } from '../config/deployment-summary';
import { ApiException } from '../http/api-exception';
import { AuthRuntime } from '../identity/auth-runtime';
import type { PlatformPrincipal } from './platform-access.service';

@Injectable()
export class PlatformSettings {
  constructor(
    private readonly runtime: AuthRuntime,
    @Inject(PLATFORM_DEPLOYMENT_SUMMARY)
    private readonly deployment: DeploymentSummary,
  ) {}

  async get(actor: PlatformPrincipal, requestId: string): Promise<Settings> {
    const setting = await this.call<
      Pick<Settings, 'platformDefaultLocale' | 'version'>
    >('SELECT public.get_platform_settings($1,$2,$3) AS result', [
      actor.userId,
      actor.sessionId,
      requestId,
    ]);
    return {
      ...setting,
      supportedLocales: [...supportedLocales],
      ...this.deployment,
    };
  }

  update(
    actor: PlatformPrincipal,
    input: UpdatePlatformSettings,
    key: string,
    requestId: string,
  ): Promise<PlatformSettingsUpdateResult> {
    return this.call(
      'SELECT public.update_platform_settings($1,$2,$3,$4,$5,$6,$7) AS result',
      [
        actor.userId,
        actor.sessionId,
        input.platformDefaultLocale,
        input.reason,
        input.expectedVersion,
        key,
        requestId,
      ],
    );
  }

  private async call<T>(statement: string, values: unknown[]): Promise<T> {
    try {
      return (await this.runtime.pool.query<{ result: T }>(statement, values))
        .rows[0].result;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'P0001') {
        const code = ApiErrorCodeSchema.safeParse(error.message);
        const statuses: Partial<Record<ApiErrorCode, number>> = {
          FORBIDDEN: 403,
          PLATFORM_MFA_REQUIRED: 403,
          VALIDATION_ERROR: 400,
          VERSION_CONFLICT: 409,
          IDEMPOTENCY_KEY_REUSED: 409,
          AUDIT_UNAVAILABLE: 503,
          AUTHORIZATION_UNAVAILABLE: 503,
        };
        if (code.success && statuses[code.data])
          throw new ApiException(statuses[code.data]!, code.data);
      }
      throw error;
    }
  }
}
