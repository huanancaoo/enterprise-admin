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
    this.hooks = new EmailService(pool, config.email, allowedOrigins).hooks();
    this.smtp = new SmtpEmailProvider(config.email.smtp, config.email.from);
    this.dispatcher = new EmailDispatcher(pool, this.smtp, config.email);
  }

  start(): void {
    this.dispatcher.start();
  }

  onModuleDestroy(): void {
    // Nest 先执行 module destroy，再关闭身份连接池，投递器不能继续领取新任务。
    this.dispatcher.stop();
    this.smtp.close();
  }
}
