import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  createMembershipTenantRunner,
  TaskAuthorizationError,
} from '@workspace/database/task-tenant';
import { notificationRepository } from '@workspace/database/repositories/notifications';
import type { TenantContext, TenantTx } from '@workspace/database/tenant';
import {
  NotificationPageSchema,
  NotificationSchema,
  type CapabilityPageQuery,
} from '@workspace/contracts';
import { AuthRuntime } from '../identity/auth-runtime';
import { ApiException } from '../http/api-exception';

@Injectable()
export class Notifications {
  constructor(private readonly runtime: AuthRuntime) {}

  private async transaction<T>(
    context: TenantContext,
    work: (tx: TenantTx) => Promise<T>,
  ): Promise<T> {
    try {
      return await createMembershipTenantRunner(this.runtime.pool)(
        {
          organizationId: context.organizationId,
          actorId: context.userId,
          resourceId: context.organizationId,
          locale: context.locale,
          requestId: context.requestId,
        },
        work,
      );
    } catch (error) {
      if (!(error instanceof TaskAuthorizationError)) throw error;
      if (error.code === 'ORGANIZATION_SUSPENDED')
        throw new ApiException(403, error.code);
      throw new ForbiddenException();
    }
  }

  async list(context: TenantContext, query: CapabilityPageQuery) {
    const page = await this.transaction(context, (tx) =>
      notificationRepository.listPage(tx, query),
    );
    return NotificationPageSchema.parse({
      ...page,
      items: page.items.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
        readAt: item.readAt?.toISOString() ?? null,
      })),
    });
  }

  async read(context: TenantContext, id: string) {
    const item = await this.transaction(context, (tx) =>
      notificationRepository.read(tx, id),
    );
    if (!item) throw new NotFoundException();
    return NotificationSchema.parse({
      ...item,
      createdAt: item.createdAt.toISOString(),
      readAt: item.readAt?.toISOString() ?? null,
    });
  }
  preferences(context: TenantContext) {
    return this.transaction(context, (tx) =>
      notificationRepository.preferences(tx),
    );
  }
  updatePreferences(context: TenantContext, emailEnabled: boolean) {
    return this.transaction(context, (tx) =>
      notificationRepository.updatePreferences(tx, emailEnabled),
    );
  }
}
