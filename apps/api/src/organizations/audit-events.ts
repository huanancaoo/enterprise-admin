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
import { auditEventCursorSchema, createAuditEventCursor } from './audit-cursor';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 90;

type EffectiveFilters = Omit<AuditEventFilter, 'result'> & {
  result?: AuditResult;
  limit: number;
};

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
    const now = new Date();
    const cursor = query.cursor ? this.readCursor(query.cursor) : undefined;
    const filters = this.normalizeFilters(query, cursor, now);
    const page = await createTenantRunner(this.runtime.pool)(context, (tx) =>
      auditRepository.listPage(tx, {
        filter: filters,
        limit: filters.limit,
        cursor: cursor?.before,
      }),
    );
    return {
      items: page.items.map(projectEvent),
      nextCursor: page.nextCursor
        ? createAuditEventCursor({
            filters: this.cursorFilters(filters),
            snapshotAt: cursor?.snapshotAt ?? filters.to.toISOString(),
            before: page.nextCursor,
          })
        : null,
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
    cursor: ReturnType<typeof auditEventCursorSchema.parse> | undefined,
    now: Date,
  ): EffectiveFilters {
    if (cursor) {
      for (const key of [
        'from',
        'to',
        'actorId',
        'eventCode',
        'resourceType',
        'resourceId',
        'result',
      ] as const) {
        if (query[key] !== undefined && query[key] !== cursor.filters[key]) {
          throw new BadRequestException('Audit cursor does not match filters');
        }
      }
    }

    const upperBound = cursor
      ? new Date(cursor.filters.to)
      : query.to
        ? new Date(query.to)
        : now;
    const from = cursor
      ? new Date(cursor.filters.from)
      : query.from
        ? new Date(query.from)
        : new Date(upperBound.getTime() - 30 * DAY_MS);
    if (
      from > upperBound ||
      upperBound > now ||
      upperBound.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS
    ) {
      throw new BadRequestException('Audit range must be at most 90 days');
    }

    return {
      from,
      to: cursor ? new Date(cursor.snapshotAt) : upperBound,
      actorId: cursor?.filters.actorId ?? query.actorId,
      eventCode: cursor?.filters.eventCode ?? query.eventCode,
      resourceType: cursor?.filters.resourceType ?? query.resourceType,
      resourceId: cursor?.filters.resourceId ?? query.resourceId,
      result: cursor?.filters.result ?? query.result,
      limit: cursor?.filters.limit ?? query.limit,
    };
  }

  private cursorFilters(filters: EffectiveFilters) {
    return {
      from: filters.from.toISOString(),
      to: filters.to.toISOString(),
      actorId: filters.actorId,
      eventCode: filters.eventCode,
      resourceType: filters.resourceType,
      resourceId: filters.resourceId,
      result: filters.result,
      limit: filters.limit,
    };
  }

  private readCursor(encoded: string) {
    try {
      const parsed = JSON.parse(
        Buffer.from(encoded, 'base64url').toString(),
      ) as unknown;
      return auditEventCursorSchema.parse(parsed);
    } catch {
      throw new BadRequestException('Invalid audit cursor');
    }
  }
}
