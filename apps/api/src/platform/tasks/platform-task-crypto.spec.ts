import { describe, expect, it } from 'vitest';
import {
  decryptPlatformTaskCredential,
  encryptPlatformTaskCredential,
} from './platform-task-crypto';

describe('platform task credentials', () => {
  it('encrypts a batch credential and binds it to its task', () => {
    const master = Buffer.alloc(32, 4);
    const sealed = encryptPlatformTaskCredential(
      'password-hash',
      master,
      'task-a',
    );
    expect(sealed).not.toContain('password-hash');
    expect(decryptPlatformTaskCredential(sealed, master, 'task-a')).toBe(
      'password-hash',
    );
    expect(() =>
      decryptPlatformTaskCredential(sealed, master, 'task-b'),
    ).toThrow();
    expect(() =>
      decryptPlatformTaskCredential(sealed, Buffer.alloc(32, 5), 'task-a'),
    ).toThrow();
  });
});
