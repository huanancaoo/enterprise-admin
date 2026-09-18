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
    if (!info.messageId) throw new Error('SMTP_ERROR');
    return { providerMessageId: info.messageId };
  }

  close(): void {
    this.transporter.close();
  }
}
