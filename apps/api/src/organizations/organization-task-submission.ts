import { Injectable } from '@nestjs/common';
import type {
  CreateAuditExport,
  CreateMemberExport,
  CreateOrganizationInvitationImport,
} from '@workspace/contracts';
import {
  assertInvitationRole,
  invitationTenantExecutor,
} from '@workspace/database/invitation-command';
import type { TenantContext } from '@workspace/database/tenant';
import { APIError } from 'better-auth/api';
import { BusinessTasks } from '../business/business-tasks';
import { ApiException } from '../http/api-exception';
import { AuthRuntime } from '../identity/auth-runtime';
import { normalizeAuditFilters } from './audit-query';

@Injectable()
export class OrganizationTaskSubmission {
  constructor(
    private readonly tasks: BusinessTasks,
    private readonly runtime: AuthRuntime,
  ) {}
  async exportMembers(
    context: TenantContext,
    input: CreateMemberExport,
    key: string,
  ) {
    return this.tasks.submit(context, input, key, 'members.export');
  }
  async exportAudit(
    context: TenantContext,
    input: CreateAuditExport,
    key: string,
  ) {
    normalizeAuditFilters(
      { ...input.filter, page: 1, pageSize: 20 },
      new Date(),
    );
    return this.tasks.submit(context, input, key, 'audit.export');
  }
  async importInvitations(
    context: TenantContext,
    input: CreateOrganizationInvitationImport,
    key: string,
    sourceIp?: string,
  ) {
    return this.tasks.submit(
      context,
      {
        ...input,
        sourceIpHash: this.runtime.invitationIpHash(sourceIp),
      },
      key,
      'invitations.import',
      async (tx) => {
        try {
          await assertInvitationRole(
            invitationTenantExecutor(tx),
            context.organizationId,
            context.userId,
            input.role,
          );
        } catch (error) {
          if (error instanceof APIError) {
            if (
              error.body?.code === 'FORBIDDEN' ||
              error.body?.code === 'INVITATION_ROLE_FORBIDDEN'
            )
              throw new ApiException(403, 'FORBIDDEN');
            if (
              error.body?.code === 'ROLE_NOT_FOUND' ||
              error.body?.code === 'SINGLE_ROLE_REQUIRED'
            )
              throw new ApiException(400, 'VALIDATION_ERROR');
          }
          throw error;
        }
      },
    );
  }
}
