import { Injectable } from '@nestjs/common';
import {
  OrganizationInvitationDirectoryPageSchema,
  OrganizationRoleDirectoryPageSchema,
  type OrganizationInvitationDirectoryQuery,
  type OrganizationRoleDirectoryQuery,
} from '@workspace/contracts';
import {
  listOrganizationInvitationDirectory,
  listOrganizationRoleDirectory,
} from '@workspace/database';
import type { TenantContext, TenantTx } from '@workspace/database/tenant';
import { TenantWrite } from '../tenancy/tenant-write';

@Injectable()
export class OrganizationDirectories {
  constructor(private readonly writes: TenantWrite) {}

  private read<T>(
    context: TenantContext,
    headers: Headers,
    resource: 'ac' | 'invitation',
    work: (tx: TenantTx) => Promise<T>,
  ): Promise<T> {
    // 原生身份目录也沿用身份→组织→成员锁序，读取与最终授权共用同一连接。
    return this.writes.transaction(
      context,
      headers,
      resource === 'ac'
        ? [{ ac: ['read'] }]
        : [{ invitation: ['create'] }, { invitation: ['cancel'] }],
      work,
    );
  }

  roles(
    context: TenantContext,
    headers: Headers,
    query: OrganizationRoleDirectoryQuery,
  ) {
    return this.read(context, headers, 'ac', async (tx) =>
      OrganizationRoleDirectoryPageSchema.parse(
        await listOrganizationRoleDirectory(tx, query),
      ),
    );
  }

  invitations(
    context: TenantContext,
    headers: Headers,
    query: OrganizationInvitationDirectoryQuery,
  ) {
    return this.read(context, headers, 'invitation', async (tx) =>
      OrganizationInvitationDirectoryPageSchema.parse(
        await listOrganizationInvitationDirectory(tx, query),
      ),
    );
  }
}
