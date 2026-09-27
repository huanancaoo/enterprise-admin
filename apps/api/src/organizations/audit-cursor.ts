import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  AuditEventCursorSchema,
  type AuditEventCursor as AuditCursor,
} from '@workspace/contracts';

export const auditEventCursorSchema = AuditEventCursorSchema;

export function createAuditEventCursor(
  input: AuditCursor,
  signingKey: Uint8Array,
): string {
  const payload = Buffer.from(
    JSON.stringify(auditEventCursorSchema.parse(input)),
  ).toString('base64url');
  const signature = createHmac('sha256', signingKey)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

export function parseAuditEventCursor(
  encoded: string,
  signingKey: Uint8Array,
): AuditCursor {
  const [payload, signature, extra] = encoded.split('.');
  if (
    !payload ||
    !signature ||
    extra !== undefined ||
    !/^[A-Za-z0-9_-]{43}$/.test(signature)
  ) {
    throw new Error('Invalid audit cursor signature');
  }

  const expected = createHmac('sha256', signingKey).update(payload).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error('Invalid audit cursor signature');
  }

  const parsed = JSON.parse(
    Buffer.from(payload, 'base64url').toString(),
  ) as unknown;
  return auditEventCursorSchema.parse(parsed);
}
