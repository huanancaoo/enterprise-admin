import { BadRequestException } from '@nestjs/common';
import type { AuditEventsQuery, AuditResult } from '@workspace/contracts';
import type { AuditEventFilter } from '@workspace/database/repositories/audit';

const DAY_MICROSECONDS = 24 * 60 * 60 * 1_000_000;
const MAX_RANGE_DAYS = 90;

export type EffectiveFilters = Omit<AuditEventFilter, 'result'> & {
  result?: AuditResult;
  page: number;
  pageSize: number;
};

function instantMicroseconds(value: string): number {
  const milliseconds = Date.parse(value);
  const fraction = /\.(\d+)Z$/.exec(value)?.[1] ?? '';
  // Date.parse keeps milliseconds only, while PostgreSQL audit boundaries use microseconds.
  const remainingMicroseconds = Number((fraction + '000000').slice(3, 6));
  return milliseconds * 1000 + remainingMicroseconds;
}

function isoMicroseconds(value: number): string {
  const milliseconds = Math.floor(value / 1000);
  const fractionalMicroseconds = value - milliseconds * 1000;
  const date = new Date(milliseconds).toISOString();
  return `${date.slice(0, 19)}.${String(
    Math.floor(milliseconds % 1000) * 1000 + fractionalMicroseconds,
  ).padStart(6, '0')}Z`;
}

export function normalizeAuditFilters(
  query: AuditEventsQuery,
  now: Date,
): EffectiveFilters {
  const upperBound = query.to ?? now.toISOString();
  const upperBoundMicros = instantMicroseconds(upperBound);
  const from =
    query.from ?? isoMicroseconds(upperBoundMicros - 30 * DAY_MICROSECONDS);
  const fromMicros = instantMicroseconds(from);
  const nowMicros = now.getTime() * 1000;
  if (
    fromMicros > upperBoundMicros ||
    upperBoundMicros > nowMicros ||
    upperBoundMicros - fromMicros > MAX_RANGE_DAYS * DAY_MICROSECONDS
  ) {
    throw new BadRequestException('Audit range must be at most 90 days');
  }

  return {
    from,
    to: upperBound,
    actorId: query.actorId,
    eventCode: query.eventCode,
    resourceType: query.resourceType,
    resourceId: query.resourceId,
    result: query.result,
    page: query.page,
    pageSize: query.pageSize,
  };
}
