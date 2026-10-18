import { beforeEach, expect, it, vi } from 'vitest';
import type { createDatabase } from '@workspace/database';
import type { EmailConfig } from './email-config';
import type { EmailProvider } from './email-provider';
import { EmailService } from './email.service';

vi.mock('@workspace/database', async (original) => ({
  ...(await original<typeof import('@workspace/database')>()),
  readPlatformDefaultLocale: () => Promise.resolve('en-US'),
}));
const delivery = {
  id: '9f63bc9b-3ef5-45e2-9bdd-cfc8baebf8ca',
  attemptId: '0c280c8e-08e5-4eb4-ab83-eb6155b6f059',
  actorId: '38a18385-1321-4864-9800-bc9717d4633c',
  requestId: 'invitation-delivery-test',
  email: 'recipient@example.test',
  role: 'member',
  organization: {
    id: 'ea698c8e-fe9e-4337-aec3-5cb81139666e',
    name: 'Delivery org',
    defaultLocale: 'en-US',
  },
  invitation: { id: '9f63bc9b-3ef5-45e2-9bdd-cfc8baebf8ca' },
  inviter: { user: { name: 'Inviter' } },
};
const send = vi.fn<EmailProvider['send']>();
let claimed: boolean;
const writes: unknown[][] = [];
function service() {
  const query = vi.fn((text: string, values?: unknown[]) => {
    if (text.includes('claim_invitation_delivery')) {
      const value = claimed ? null : delivery;
      claimed = true;
      return Promise.resolve({ rows: [{ delivery: value }] });
    }
    if (text.includes('preferred_locale')) return Promise.resolve({ rows: [] });
    writes.push([text, values]);
    return Promise.resolve({ rows: [] });
  });
  const client = { query, release: vi.fn() };
  const pool = {
    query,
    connect: vi.fn(() => Promise.resolve(client)),
  } as unknown as ReturnType<typeof createDatabase>['pool'];
  const config = { linkOrigin: 'http://localhost:3200' } as EmailConfig;
  return new EmailService(pool, config, ['http://localhost:3200'], { send });
}
beforeEach(() => {
  vi.resetAllMocks();
  claimed = false;
  writes.length = 0;
  send.mockResolvedValue({ providerMessageId: 'test' });
});
it('shares one claim between native immediate delivery and dispatcher', async () => {
  const runtime = service();
  await Promise.all([
    runtime.sendInvitation(delivery),
    runtime.dispatchInvitation(),
  ]);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][0].to).toBe(delivery.email);
  expect(
    writes.some(
      ([text, values]) =>
        String(text).includes('UPDATE invitation_delivery_attempts') &&
        (values as unknown[])?.[1] === 'smtp_accepted',
    ),
  ).toBe(true);
});
it('does not resend an unknown SMTP outcome', async () => {
  send.mockRejectedValue({ code: 'ETIMEDOUT' });
  const runtime = service();
  await runtime.sendInvitation(delivery);
  await runtime.dispatchInvitation();
  await runtime.sendInvitation(delivery);
  expect(send).toHaveBeenCalledTimes(1);
  expect(
    writes.some(
      ([text, values]) =>
        String(text).includes('UPDATE invitation_delivery_attempts') &&
        (values as unknown[])?.[1] === 'unknown',
    ),
  ).toBe(true);
});
it('does not send when the shared claim rejects a canceled or already claimed invitation', async () => {
  claimed = true;
  const runtime = service();
  expect(await runtime.dispatchInvitation()).toBe(false);
  await runtime.sendInvitation(delivery);
  expect(send).not.toHaveBeenCalled();
});
it('records a known SMTP rejection without retrying its invitation intent', async () => {
  send.mockRejectedValue({ code: 'ECONNREFUSED' });
  const runtime = service();
  await runtime.sendInvitation(delivery);
  await runtime.dispatchInvitation();
  expect(send).toHaveBeenCalledTimes(1);
  expect(
    writes.some(
      ([text, values]) =>
        String(text).includes('UPDATE invitation_delivery_attempts') &&
        (values as unknown[])?.[1] === 'failed' &&
        (values as unknown[])?.[2] === 'SMTP_CONNECTION_FAILED',
    ),
  ).toBe(true);
  expect(
    writes.some(
      ([text, values]) =>
        String(text).includes('INSERT INTO audit_events') &&
        (values as unknown[])?.[6] === 'failed',
    ),
  ).toBe(true);
});
