import { normalizeAuditFilters } from './audit-query';
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  createTenantRunner,
  type TenantContext,
} from '@workspace/database/tenant';
import { auditRepository } from '@workspace/database/repositories/audit';
import type {
  AuditEvent,
  AuditEventsPage,
  AuditEventsQuery,
} from '@workspace/contracts';
import { AuthRuntime } from '../identity/auth-runtime';

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
    const filters = normalizeAuditFilters(query, new Date());
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
}
