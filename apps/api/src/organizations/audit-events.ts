import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  createTenantRunner,
  type TenantContext,
} from '@workspace/database/tenant';
import {
  auditRepository,
  type AuditEventFilter,
} from '@workspace/database/repositories/audit';
import type {
  AuditEvent,
  AuditEventsPage,
  AuditEventsQuery,
  AuditResult,
} from '@workspace/contracts';
import { AuthRuntime } from '../identity/auth-runtime';

const DAY_MICROSECONDS = 24 * 60 * 60 * 1_000_000;
const MAX_RANGE_DAYS = 90;

type EffectiveFilters = Omit<AuditEventFilter, 'result'> & {
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

function filterMetadata(eventCode: string, fields: Record<string, unknown>) {
  const keys =
    eventCode === 'project.created' || eventCode === 'project.deleted'
      ? ['status', 'contentLocale']
      : eventCode === 'project.updated'
        ? ['status']
        : eventCode === 'project.translation.updated'
          ? ['locale']
          : [];
  return Object.fromEntries(
    keys.flatMap((key) =>
      Object.hasOwn(fields, key) ? [[key, fields[key]]] : [],
    ),
  );
}

function projectEvent(
  row: Awaited<ReturnType<typeof auditRepository.findVisibleById>>,
): AuditEvent {
  if (!row || (row.scope !== 'tenant' && row.scope !== 'platform'))
    throw new NotFoundException();
  const platformEvent = row.scope === 'platform';
  return {
    id: row.id,
    occurredAt: row.occurredAt,
    eventCode: row.eventCode,
    scope: row.scope,
    actorType: row.actorType as AuditEvent['actorType'],
    actorId: platformEvent ? null : row.actorId,
    resourceType: platformEvent ? null : row.resourceType,
    resourceId: platformEvent ? null : row.resourceId,
    result: row.result as AuditEvent['result'],
    publicSummary: platformEvent ? row.publicSummary : null,
    metadata: platformEvent ? {} : filterMetadata(row.eventCode, row.fields),
  };
}

@Injectable()
export class OrganizationAuditEvents {
  constructor(private readonly runtime: AuthRuntime) {}

  async list(
    context: TenantContext,
    query: AuditEventsQuery,
  ): Promise<AuditEventsPage> {
    const filters = this.normalizeFilters(query, new Date());
    const page = await createTenantRunner(this.runtime.pool)(context, (tx) =>
      auditRepository.listPage(tx, {
        filter: filters,
        page: filters.page,
        pageSize: filters.pageSize,
      }),
    );
    return {
      items: page.items.map(projectEvent),
      page: page.page,
      pageSize: page.pageSize,
      total: page.total,
      window: { from: filters.from, to: filters.to },
    };
  }

  async get(context: TenantContext, eventId: string): Promise<AuditEvent> {
    const event = await createTenantRunner(this.runtime.pool)(context, (tx) =>
      auditRepository.findVisibleById(tx, eventId),
    );
    return projectEvent(event);
  }

  private normalizeFilters(
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
}
