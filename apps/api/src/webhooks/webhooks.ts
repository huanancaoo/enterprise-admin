import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  CreatedWebhookSchema,
  WebhookListSchema,
  WebhookSchema,
  WebhookDeliveryPageSchema,
  type UpdateWebhook,
  type CapabilityPageQuery,
  type CreateWebhook,
} from '@workspace/contracts';
import {
  createTaskTenantRunner,
  TaskAuthorizationError,
} from '@workspace/database/task-tenant';
import { webhookRepository } from '@workspace/database/repositories/webhooks';
import type { TenantContext, TenantTx } from '@workspace/database/tenant';
import type { PermissionRequest } from '@workspace/permissions';
import { AuthRuntime } from '../identity/auth-runtime';
import { ApiException } from '../http/api-exception';

@Injectable()
export class Webhooks {
  constructor(private readonly runtime: AuthRuntime) {}
  private async transaction<T>(
    context: TenantContext,
    permissions: PermissionRequest,
    work: (tx: TenantTx) => Promise<T>,
  ): Promise<T> {
    try {
      return await createTaskTenantRunner(this.runtime.pool)(
        {
          organizationId: context.organizationId,
          actorId: context.userId,
          resourceId: context.organizationId,
          locale: context.locale,
          requestId: context.requestId,
        },
        permissions,
        work,
      );
    } catch (error) {
      if (!(error instanceof TaskAuthorizationError)) throw error;
      if (error.code === 'ORGANIZATION_SUSPENDED')
        throw new ApiException(403, error.code);
      throw new ForbiddenException();
    }
  }
  async create(context: TenantContext, input: CreateWebhook) {
    const signingSecret = `whsec_${randomBytes(32).toString('base64')}`;
    const item = await this.transaction(
      context,
      { integration: ['manage'] },
      (tx) => webhookRepository.create(tx, input, signingSecret),
    );
    return CreatedWebhookSchema.parse({
      ...item,
      createdAt: item.createdAt.toISOString(),
      signingSecret,
    });
  }
  async list(context: TenantContext) {
    const items = await this.transaction(
      context,
      { integration: ['read'] },
      (tx) => webhookRepository.list(tx),
    );
    return WebhookListSchema.parse(
      items.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
      })),
    );
  }
  async update(context: TenantContext, id: string, input: UpdateWebhook) {
    const item = await this.transaction(
      context,
      { integration: ['manage'] },
      (tx) => webhookRepository.update(tx, id, input),
    );
    if (!item) throw new NotFoundException();
    return WebhookSchema.parse({
      ...item,
      createdAt: item.createdAt.toISOString(),
    });
  }
  async delete(context: TenantContext, id: string) {
    const item = await this.transaction(
      context,
      { integration: ['manage'] },
      (tx) => webhookRepository.delete(tx, id),
    );
    if (!item) throw new NotFoundException();
  }
  async deliveries(
    context: TenantContext,
    id: string,
    query: CapabilityPageQuery,
  ) {
    const page = await this.transaction(
      context,
      { integration: ['read'] },
      (tx) => webhookRepository.deliveries(tx, id, query),
    );
    if (!page) throw new NotFoundException();
    return WebhookDeliveryPageSchema.parse({
      ...page,
      items: page.items.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
        deliveredAt: item.deliveredAt?.toISOString() ?? null,
        nextAttemptAt: item.nextAttemptAt?.toISOString() ?? null,
      })),
    });
  }
}
