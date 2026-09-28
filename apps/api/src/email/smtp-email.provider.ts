import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { EmailFrom, SmtpConfig } from './email-config';
import type { EmailProvider, OutboundEmail } from './email-provider';

export class SmtpEmailProvider implements EmailProvider {
  private readonly transporter: Transporter;

  constructor(
    smtp: SmtpConfig,
    private readonly from: EmailFrom,
  ) {
    this.transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      pool: true,
      // 每个业务 attempt 只尝试一次；连接中断不能由池自动重发并掩盖未知结果。
      maxRequeues: 0,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
      disableFileAccess: true,
      disableUrlAccess: true,
      ...(smtp.user ? { auth: { user: smtp.user, pass: smtp.password } } : {}),
    });
  }

  async send(message: OutboundEmail): Promise<{ providerMessageId: string }> {
    const info = await this.transporter.sendMail({
      from: `"${this.from.name}" <${this.from.email}>`,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    if (!info.messageId || !info.accepted?.length) {
      throw new Error('SMTP_RESULT_UNKNOWN');
    }
    return { providerMessageId: info.messageId };
  }

  close(): void {
    this.transporter.close();
  }
}
