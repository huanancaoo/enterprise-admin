import { createDatabase } from '@workspace/database';
import type { EmailConfig } from './email-config';

type RuntimePool = ReturnType<typeof createDatabase>['pool'];
import { decryptEmailPayload } from './email-crypto';
import type { EmailProvider, OutboundEmail } from './email-provider';
import { nextEmailAttemptDelayMs } from './retry-policy';

type ClaimedMessage = {
  id: string;
  template_key: string;
  payload_ciphertext: Buffer;
  attempt_count: number;
};

export class EmailDispatcher {
  private stopped = true;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly pool: RuntimePool,
    private readonly provider: EmailProvider,
    private readonly config: EmailConfig,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.dispatchOne();
    } catch (error) {
      console.error({
        event: 'email.dispatch.tick_failed',
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.tick();
    }, this.config.pollIntervalMs);
  }

  async dispatchOne(): Promise<boolean> {
    const claimed = await this.claim();
    if (!claimed) return false;
    try {
      const payload = JSON.parse(
        decryptEmailPayload(
          claimed.payload_ciphertext,
          this.config.encryptionKey,
        ),
      ) as OutboundEmail;
      const sent = await this.provider.send(payload);
      await this.pool.query(
        `UPDATE email_messages
         SET status = 'accepted',
             accepted_at = now(),
             provider_message_id = $2,
             payload_ciphertext = $3,
             payload_key_id = NULL,
             last_error_code = NULL,
             updated_at = now()
         WHERE id = $1`,
        [claimed.id, sent.providerMessageId, Buffer.alloc(0)],
      );
      return true;
    } catch (error) {
      const errorCode =
        error instanceof Error && error.message === 'PAYLOAD_DECRYPT'
          ? 'PAYLOAD_DECRYPT'
          : 'SMTP_ERROR';
      const attemptCount = claimed.attempt_count + 1;
      const failed = attemptCount >= this.config.retry.maxAttempts;
      await this.pool.query(
        `UPDATE email_messages
         SET attempt_count = $2,
             status = $3,
             next_attempt_at = $4,
             last_error_code = $5,
             updated_at = now()
         WHERE id = $1`,
        [
          claimed.id,
          attemptCount,
          failed ? 'failed' : 'retry',
          new Date(
            Date.now() +
              nextEmailAttemptDelayMs(
                attemptCount,
                this.config.retry.baseDelayMs,
              ),
          ),
          errorCode,
        ],
      );
      console.error({
        event: 'email.dispatch.failed',
        messageId: claimed.id,
        templateKey: claimed.template_key,
        errorCode,
      });
      return true;
    }
  }

  private async claim(): Promise<ClaimedMessage | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE email_messages
         SET status = 'expired', updated_at = now()
         WHERE status IN ('queued', 'retry') AND expires_at <= now()`,
      );
      const claimed = await client.query<ClaimedMessage>(
        `WITH next_message AS (
           SELECT id
           FROM email_messages
           WHERE (
             status IN ('queued', 'retry')
             OR (status = 'sending' AND updated_at < now() - interval '2 minutes')
           )
             AND next_attempt_at <= now()
             AND expires_at > now()
           ORDER BY created_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         UPDATE email_messages AS message
         SET status = 'sending', updated_at = now()
         FROM next_message
         WHERE message.id = next_message.id
         RETURNING message.id, message.template_key, message.payload_ciphertext, message.attempt_count`,
      );
      await client.query('COMMIT');
      return claimed.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
