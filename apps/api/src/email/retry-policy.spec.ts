import { describe, expect, it } from 'vitest';
import { nextEmailAttemptDelayMs } from './retry-policy';

describe('retry-policy', () => {
  it('uses exponential backoff plus jitter in [0, baseDelayMs)', () => {
    const base = 50;
    for (let i = 0; i < 40; i++) {
      const first = nextEmailAttemptDelayMs(1, base);
      expect(first).toBeGreaterThanOrEqual(50);
      expect(first).toBeLessThan(100);
      const third = nextEmailAttemptDelayMs(3, base);
      expect(third).toBeGreaterThanOrEqual(200);
      expect(third).toBeLessThan(250);
    }
  });
});
