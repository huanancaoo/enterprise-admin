import { Injectable } from '@nestjs/common';
import type {
  MyPreferences,
  OrganizationSettings,
  UpdateMyPreferences,
  UpdateOrganizationSettings,
} from '@workspace/contracts';
import {
  createTenantRunner,
  type TenantContext,
} from '@workspace/database/tenant';
import { organizationSettingsRepository } from '@workspace/database/repositories/organization-settings';
import { ApiException } from '../http/api-exception';
import { AuthRuntime } from '../identity/auth-runtime';
import type { Identity } from '../identity/identity.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { runTenantWrite } from '../tenancy/tenant-write';
import type { RequestLanguage } from '../http/request-language';

@Injectable()
export class LocaleSettings {
  constructor(
    private readonly runtime: AuthRuntime,
    private readonly authorization: AuthorizationService,
  ) {}

  async getMyPreferences(
    identity: Identity,
    language: RequestLanguage,
  ): Promise<MyPreferences> {
    const result = await this.runtime.pool.query<{
      preferred_locale: string | null;
      preferred_locale_version: number;
    }>(
      `SELECT preferred_locale, preferred_locale_version
       FROM public."user" WHERE id = $1`,
      [identity.userId],
    );
    const preference = result.rows[0];
    if (!preference) throw new ApiException(401, 'UNAUTHENTICATED');
    language.useUserPreference(preference.preferred_locale);
    const resolution = language.resolution;
    return {
      preferredLocale:
        preference.preferred_locale as MyPreferences['preferredLocale'],
      version: preference.preferred_locale_version,
      effectiveLocale: resolution.locale,
      effectiveLocaleSource: resolution.source,
    };
  }

  async updateMyPreferences(
    identity: Identity,
    input: UpdateMyPreferences,
    language: RequestLanguage,
  ): Promise<MyPreferences> {
    const result = await this.runtime.pool.query<{
      preferred_locale: string | null;
      preferred_locale_version: number;
    }>(
      `UPDATE public."user"
       SET preferred_locale = $1,
           preferred_locale_version = preferred_locale_version + 1,
           updated_at = now()
       WHERE id = $2 AND preferred_locale_version = $3
       RETURNING preferred_locale, preferred_locale_version`,
      [input.preferredLocale, identity.userId, input.expectedVersion],
    );
    const preference = result.rows[0];
    if (!preference) throw new ApiException(409, 'VERSION_CONFLICT');
    language.useUserPreference(preference.preferred_locale);
    const resolution = language.resolution;
    return {
      preferredLocale:
        preference.preferred_locale as MyPreferences['preferredLocale'],
      version: preference.preferred_locale_version,
      effectiveLocale: resolution.locale,
      effectiveLocaleSource: resolution.source,
    };
  }

  async getOrganizationSettings(
    context: TenantContext,
  ): Promise<OrganizationSettings> {
    const result = await createTenantRunner(this.runtime.pool)(context, (tx) =>
      organizationSettingsRepository.find(tx, context.organizationId),
    );
    const setting = result[0];
    if (!setting) throw new ApiException(404, 'NOT_FOUND');
    return setting;
  }

  async updateOrganizationSettings(
    context: TenantContext,
    input: UpdateOrganizationSettings,
    headers: Headers,
  ): Promise<OrganizationSettings> {
    return runTenantWrite(this.runtime.pool, context, async (tx) => {
      // 组织写锁先于权限复核；并发撤权和设置修改按同一组织顺序线性化。
      await this.authorization.requirePermission(
        headers,
        context.organizationId,
        {
          tenantSettings: ['update'],
        },
      );
      const [setting] = await organizationSettingsRepository.update(tx, {
        organizationId: context.organizationId,
        expectedVersion: input.expectedVersion,
        defaultLocale: input.defaultLocale,
      });
      if (!setting) throw new ApiException(409, 'VERSION_CONFLICT');
      return setting;
    });
  }
}
