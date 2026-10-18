import { describe, expect, it } from 'vitest';
import { nextScheduleOccurrence } from './registry';

describe('platform schedule Cron clock', () => {
  it('accepts five-field minute schedules and interprets IANA local time', () => {
    expect(
      nextScheduleOccurrence(
        '0 9 * * *',
        'Asia/Shanghai',
        new Date('2026-10-18T00:30:00Z'),
      ),
    ).toBe('2026-10-18T01:00:00.000Z');
    expect(
      nextScheduleOccurrence(
        '* * * * *',
        'UTC',
        new Date('2026-10-18T00:30:45Z'),
      ),
    ).toBe('2026-10-18T00:31:00.000Z');
  });
  it('uses the registered timezone clock across a daylight-saving boundary', () => {
    expect(
      nextScheduleOccurrence(
        '0 9 * * *',
        'America/New_York',
        new Date('2026-03-08T10:00:00Z'),
      ),
    ).toBe('2026-03-08T13:00:00.000Z');
  });
  it.each([
    ['* * * * * *', 'UTC'],
    ['61 * * * *', 'UTC'],
    ['* * * * *', 'No/Such_Zone'],
  ])('rejects invalid schedule %s in %s', (cron, timeZone) => {
    expect(() => nextScheduleOccurrence(cron, timeZone, new Date())).toThrow();
  });
});
