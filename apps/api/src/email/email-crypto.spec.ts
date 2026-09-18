import { describe, expect, it } from 'vitest';
import {
  decryptEmailPayload,
  encryptEmailPayload,
  hashEmailUrl,
  hashRecipient,
  parseEmailEncryptionKey,
} from './email-crypto';

describe('email-crypto', () => {
  it('parses a 32-byte hex key and rejects any other encoding', () => {
    const hex = 'ab'.repeat(32);
    expect(parseEmailEncryptionKey(hex).equals(Buffer.from(hex, 'hex'))).toBe(
      true,
    );
    expect(() => parseEmailEncryptionKey('ab'.repeat(31))).toThrow(
      /64 hex characters/,
    );
    expect(() => parseEmailEncryptionKey('g'.repeat(64))).toThrow(
      /64 hex characters/,
    );
  });

  it('round-trips AES-256-GCM payloads as iv||ciphertext||tag', () => {
    const key = Buffer.alloc(32, 7);
    const blob = encryptEmailPayload('secret payload', key);
    expect(blob.length).toBeGreaterThan(12 + 16);
    expect(decryptEmailPayload(blob, key)).toBe('secret payload');
    expect(() => decryptEmailPayload(blob.subarray(0, 20), key)).toThrow(
      'PAYLOAD_DECRYPT',
    );
  });

  it('hashes recipients case-insensitively and hashes URLs as hex', () => {
    expect(
      hashRecipient('A@Example.TEST').equals(hashRecipient('a@example.test')),
    ).toBe(true);
    expect(hashEmailUrl('https://app.example/verify')).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });
});
