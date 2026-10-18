import { parseExpression } from 'cron-parser';
import type { PoolClient } from 'pg';
import type { PlatformScheduleTypes } from '@workspace/contracts';
import { ApiException } from '../../http/api-exception';
import type { PlatformMonitorService } from '../monitor/service';

export const platformScheduleTypes: PlatformScheduleTypes = [
  {
    type: 'platform.health-check',
    requiredPermissions: ['platform.monitor:read'],
  },
];

export function nextScheduleOccurrence(
  cron: string,
  timeZone: string,
  now: Date,
): string {
  try {
    if (
      cron.trim().split(/\s+/).length !== 5 ||
      !/^[A-Za-z_][A-Za-z0-9_+\-/]*$/.test(timeZone)
    )
      throw new Error('INVALID_SCHEDULE');
    new Intl.DateTimeFormat('en-US', { timeZone }).format(now);
    return parseExpression(cron, { tz: timeZone, currentDate: now })
      .next()
      .toDate()
      .toISOString();
  } catch {
    throw new ApiException(400, 'VALIDATION_ERROR');
  }
}

export function executeRegisteredSchedule(
  monitor: PlatformMonitorService,
  client: PoolClient,
) {
  // DB claim 已重新检查创建者的 schedule:run 与 monitor:read，不使用过期 Session。
  return monitor.collect(client);
}
