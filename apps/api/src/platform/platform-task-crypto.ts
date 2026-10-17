import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

function key(master: Buffer): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      master,
      Buffer.alloc(0),
      'platform-task-credential-v1',
      32,
    ),
  );
}

export function encryptPlatformTaskCredential(
  value: string,
  master: Buffer,
  taskId: string,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(master), iv);
  cipher.setAAD(Buffer.from(taskId));
  const content = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), content]).toString('base64');
}

export function decryptPlatformTaskCredential(
  value: string,
  master: Buffer,
  taskId: string,
): string {
  const content = Buffer.from(value, 'base64');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key(master),
    content.subarray(0, 12),
  );
  decipher.setAAD(Buffer.from(taskId));
  decipher.setAuthTag(content.subarray(12, 28));
  return Buffer.concat([
    decipher.update(content.subarray(28)),
    decipher.final(),
  ]).toString('utf8');
}
