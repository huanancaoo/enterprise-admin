import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import { createHmac } from 'node:crypto';
import {
  createTaskTenantRunner,
  TaskAuthorizationError,
} from '@workspace/database/task-tenant';
import { webhookRepository } from '@workspace/database/repositories/webhooks';
import { AuthRuntime } from '../identity/auth-runtime';
import { webhooksConfig, type WebhooksConfig } from './webhooks-config';

type Claim = {
  id: string;
  organizationId: string;
  actorId: string;
  webhookId: string;
  eventId: string;
  leaseToken: string;
  attempts: number;
};
@Injectable()
export class WebhookDelivery implements OnModuleDestroy {
  private readonly logger = new Logger(WebhookDelivery.name);
  private stopped = true;
  private timer: NodeJS.Timeout | undefined;
  private active: Promise<void> | undefined;
  constructor(
    private readonly runtime: AuthRuntime,
    @Inject(webhooksConfig) private readonly config: WebhooksConfig,
  ) {}
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
  }
  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.active;
  }
  // 在AuthRuntime关闭连接池前完成活动投递与租约结算。
  onModuleDestroy() {
    return this.stop();
  }
  private schedule(delay: number) {
    this.timer = setTimeout(() => {
      this.active = this.dispatchOne()
        .then(() => undefined)
        .catch(() => {
          this.logger.error({
            event: 'webhook.delivery.tick_failed',
            errorCode: 'DELIVERY_STORAGE_ERROR',
          });
        })
        .finally(() => {
          this.active = undefined;
          if (!this.stopped) this.schedule(this.config.pollIntervalMs);
        });
    }, delay);
  }
  async dispatchOne(): Promise<boolean> {
    const claim = await this.runtime.pool.query<{ value: Claim | null }>(
      'SELECT public.claim_webhook_delivery($1,$2) AS value',
      [
        Math.max(
          this.config.worker.lockDurationMs,
          this.config.timeoutMs + 1000,
        ),
        this.config.worker.attempts,
      ],
    );
    const item = claim.rows[0]?.value;
    if (!item) return false;
    let payload;
    try {
      payload = await createTaskTenantRunner(this.runtime.pool)(
        {
          organizationId: item.organizationId,
          actorId: item.actorId,
          resourceId: item.eventId,
          locale: 'zh-CN',
          requestId: item.id,
        },
        { integration: ['manage'] },
        (tx) => webhookRepository.outbound(tx, item),
      );
    } catch (error) {
      if (!(error instanceof TaskAuthorizationError)) throw error;
      await this.settle(item, 'failed', null, null);
      return true;
    }
    if (!payload) {
      await this.settle(item, 'failed', null, null);
      return true;
    }
    // 组织锁只保护执行前的当前授权读取；外部HTTP必须在TenantTx提交后进行。
    const rawBody = JSON.stringify(payload.body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac(
      'sha256',
      Buffer.from(payload.signingSecret.slice(6), 'base64'),
    )
      .update(`${item.eventId}.${timestamp}.${rawBody}`)
      .digest('base64');
    let statusCode: number | null = null;
    try {
      const response = await fetch(payload.url, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'content-type': 'application/json',
          'webhook-id': item.eventId,
          'webhook-timestamp': timestamp,
          'webhook-signature': `v1,${signature}`,
        },
        body: rawBody,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      statusCode = response.status;
      await response.body?.cancel();
    } catch {
      /* 远端可能已经接受请求；重试保留事件身份，接收端据此去重。 */
    }
    if (statusCode !== null && statusCode >= 200 && statusCode < 300) {
      await this.settle(item, 'delivered', statusCode, null);
      return true;
    }
    const failed = item.attempts >= this.config.worker.attempts;
    await this.settle(
      item,
      failed ? 'failed' : 'pending',
      statusCode,
      failed
        ? null
        : new Date(
            Date.now() +
              this.config.worker.backoffMs * 2 ** (item.attempts - 1),
          ),
    );
    return true;
  }
  private async settle(
    item: Claim,
    status: 'pending' | 'delivered' | 'failed',
    statusCode: number | null,
    next: Date | null,
  ) {
    await this.runtime.pool.query(
      'SELECT public.settle_webhook_delivery($1,$2,$3,$4,$5)',
      [item.id, item.leaseToken, status, statusCode, next],
    );
  }
}
