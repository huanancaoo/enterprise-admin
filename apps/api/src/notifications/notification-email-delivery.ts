import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  createMembershipTenantRunner,
  TaskAuthorizationError,
} from '@workspace/database/task-tenant';
import { notificationRepository } from '@workspace/database/repositories/notifications';
import {
  taskEmailCatalog,
  localeMeta,
  type EmailLocale,
} from '@workspace/i18n';
import { AuthRuntime } from '../identity/auth-runtime';
import { SmtpEmailProvider } from '../email/smtp-email.provider';
import {
  notificationsConfig,
  type NotificationsConfig,
} from './notifications-config';

type Claim = {
  id: string;
  organizationId: string;
  actorId: string;
  taskId: string;
  locale: EmailLocale;
  leaseToken: string;
  attempts: number;
};
@Injectable()
export class NotificationEmailDelivery implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationEmailDelivery.name);
  private readonly provider: SmtpEmailProvider;
  private stopped = true;
  private timer: NodeJS.Timeout | undefined;
  private active: Promise<void> | undefined;
  constructor(
    private readonly runtime: AuthRuntime,
    @Inject(notificationsConfig) private readonly config: NotificationsConfig,
  ) {
    this.provider = new SmtpEmailProvider(config.email.smtp, config.email.from);
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
  }
  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.active;
    this.provider.close();
  }
  // 在AuthRuntime关闭连接池前完成活动投递与租约结算。
  onModuleDestroy() {
    return this.stop();
  }
  private schedule(delay: number) {
    this.timer = setTimeout(() => {
      this.active = this.dispatchOne()
        .then(() => undefined)
        .catch(() =>
          this.logger.error({
            event: 'notification.email.tick_failed',
            errorCode: 'DELIVERY_STORAGE_ERROR',
          }),
        )
        .finally(() => {
          this.active = undefined;
          if (!this.stopped) this.schedule(this.config.email.pollIntervalMs);
        });
    }, delay);
  }
  async dispatchOne(): Promise<boolean> {
    const claim = await this.runtime.pool.query<{ value: Claim | null }>(
      'SELECT public.claim_notification_email($1,$2) AS value',
      [
        Math.max(60_000, this.config.worker.lockDurationMs),
        this.config.worker.attempts,
      ],
    );
    const item = claim.rows[0]?.value;
    if (!item) return false;
    let payload;
    try {
      payload = await createMembershipTenantRunner(this.runtime.pool)(
        {
          organizationId: item.organizationId,
          actorId: item.actorId,
          resourceId: item.taskId,
          locale: item.locale,
          requestId: item.id,
        },
        (tx) => notificationRepository.outbound(tx, item),
      );
    } catch (error) {
      if (!(error instanceof TaskAuthorizationError)) throw error;
      await this.settle(item, 'disabled');
      return true;
    }
    if (!payload) {
      await this.settle(item, 'disabled');
      return true;
    }
    const copy = taskEmailCatalog[item.locale];
    const target = new URL(
      `/app/tasks/${item.organizationId}`,
      this.config.email.linkOrigin,
    );
    target.searchParams.set('source', 'business');
    target.searchParams.set('taskId', item.taskId);
    const href = target.href.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
    const subject =
      payload.type === 'task.completed' ? copy.completed : copy.failed;
    let sent = false;
    // 收件地址与当前偏好在组织锁内核对；SMTP在事务提交后执行，不发送项目内容。
    try {
      await this.provider.send({
        to: payload.email,
        subject,
        html: `<!doctype html><html lang="${item.locale}" dir="${localeMeta[item.locale].direction}"><body><p>${copy.body}</p><p><a href="${href}">${copy.action}</a></p></body></html>`,
        text: `${copy.body}\n${target.href}`,
      });
      sent = true;
    } catch {
      /* SMTP结果未知时同一通知受有界attempt约束。 */
    }
    await this.settle(
      item,
      sent
        ? 'sent'
        : item.attempts >= this.config.worker.attempts
          ? 'failed'
          : 'pending',
    );
    return true;
  }
  private async settle(
    item: Claim,
    status: 'pending' | 'sent' | 'disabled' | 'failed',
  ) {
    const next = new Date(
      Date.now() +
        (status === 'pending'
          ? this.config.worker.backoffMs * 2 ** (item.attempts - 1)
          : 0),
    );
    await this.runtime.pool.query(
      'SELECT public.settle_notification_email($1,$2,$3,$4)',
      [item.id, item.leaseToken, status, next],
    );
  }
}
