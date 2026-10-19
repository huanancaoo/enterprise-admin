import type { OnModuleDestroy } from '@nestjs/common';
import type { ApplicationConfig } from '../config/application-config';
import type { AuthRuntime } from '../identity/auth-runtime';
import { EmailDispatcher } from './email-dispatcher';
import { EmailService } from './email.service';
import { emailOriginAllowlist } from './email-url';
import { SmtpEmailProvider } from './smtp-email.provider';

export class EmailRuntime implements OnModuleDestroy {
  private readonly smtp: SmtpEmailProvider;
  private readonly dispatcher: EmailDispatcher;
  readonly hooks: ReturnType<EmailService['hooks']>;

  constructor(pool: AuthRuntime['pool'], config: ApplicationConfig) {
    const allowedOrigins = emailOriginAllowlist(
      config.baseURL,
      config.email.linkOrigin,
      config.trustedOrigins,
    );
    this.smtp = new SmtpEmailProvider(config.email.smtp, config.email.from);
    const service = new EmailService(
      pool,
      config.email,
      allowedOrigins,
      this.smtp,
    );
    this.hooks = service.hooks();
    this.dispatcher = new EmailDispatcher(pool, this.smtp, config.email, () =>
      service.dispatchInvitation(),
    );
  }

  start(): void {
    this.dispatcher.start();
  }

  async onModuleDestroy(): Promise<void> {
    // Nest 先执行 module destroy，再关闭身份连接池。等在途投递结算后再关 SMTP。
    await this.dispatcher.stop();
    this.smtp.close();
  }
}
