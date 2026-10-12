import type { WorkerConfig } from '@workspace/jobs';
import type { EmailConfig } from '../email/email-config';
export type NotificationsConfig = { email: EmailConfig; worker: WorkerConfig };
export const notificationsConfig = Symbol('notificationsConfig');
