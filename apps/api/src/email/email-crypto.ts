import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

const IV_LENGTH = 12;
const TAG_LENGTH = 16;
export const EMAIL_ENCRYPTION_KEY_BYTES = 32;

export function parseEmailEncryptionKey(hex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'EMAIL_PAYLOAD_ENCRYPTION_KEY must be 32 bytes encoded as 64 hex characters',
    );
  }
  return Buffer.from(hex, 'hex');
}

export function encryptEmailPayload(plaintext: string, key: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]);
}

export function decryptEmailPayload(blob: Buffer, key: Buffer): string {
  if (blob.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('PAYLOAD_DECRYPT');
  }
  const iv = blob.subarray(0, IV_LENGTH);
  const tag = blob.subarray(blob.length - TAG_LENGTH);
  const ciphertext = blob.subarray(IV_LENGTH, blob.length - TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');
}

export function hashRecipient(email: string): Buffer {
  return createHash('sha256').update(email.trim().toLowerCase()).digest();
}

export function hashEmailUrl(url: string): string {
  return createHash('sha256').update(url).digest('hex');
}
