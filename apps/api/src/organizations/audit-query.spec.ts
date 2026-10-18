import { normalizeAuditFilters } from './audit-query';
import { describe, expect, it } from 'vitest';
describe('operation log export window', () => {
  const now = new Date('2026-10-18T08:00:00Z');
  it('preserves the list microsecond boundaries', () => {
    const query = {
      from: '2026-10-17T00:00:00.123456Z',
      to: '2026-10-18T00:00:00.654321Z',
      page: 1,
      pageSize: 20,
    };
    expect(normalizeAuditFilters(query, now)).toMatchObject(query);
  });
  it('rejects future, reversed and overlong export windows', () => {
    for (const [from, to] of [
      ['2026-10-17T00:00:00Z', '2026-10-19T00:00:00Z'],
      ['2026-10-18T00:00:00Z', '2026-10-17T00:00:00Z'],
      ['2026-01-01T00:00:00Z', '2026-10-17T00:00:00Z'],
    ])
      expect(() =>
        normalizeAuditFilters({ from, to, page: 1, pageSize: 20 }, now),
      ).toThrow();
  });
});
