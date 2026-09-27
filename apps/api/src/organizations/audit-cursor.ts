import {
  AuditEventCursorSchema,
  type AuditEventCursor as AuditCursor,
} from '@workspace/contracts';

export const auditEventCursorSchema = AuditEventCursorSchema;

export function createAuditEventCursor(input: {
  filters: AuditCursor['filters'];
  snapshotAt: string;
  before: AuditCursor['before'];
}) {
  return Buffer.from(JSON.stringify(input)).toString('base64url');
}
