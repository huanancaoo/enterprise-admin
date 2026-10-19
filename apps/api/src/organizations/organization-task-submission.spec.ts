import { beforeEach, expect, it, vi } from 'vitest';
import { APIError } from 'better-auth/api';
import type { TenantContext, TenantTx } from '@workspace/database/tenant';
import type { BusinessTasks } from '../business/business-tasks';
import type { AuthRuntime } from '../identity/auth-runtime';
import { OrganizationTaskSubmission } from './organization-task-submission';

const { assertRole, executor } = vi.hoisted(() => ({
  assertRole: vi.fn(),
  executor: vi.fn((tx: unknown) => tx),
}));
vi.mock('@workspace/database/invitation-command', () => ({
  assertInvitationRole: assertRole,
  invitationTenantExecutor: executor,
}));
beforeEach(() => {
  assertRole.mockReset();
  executor.mockClear();
});
const context = {
  organizationId: 'organization',
  userId: 'actor',
} as TenantContext;
const input = {
  format: 'xlsx' as const,
  role: 'member',
  contentBase64: 'YQ==',
};

it.each([
  ['FORBIDDEN', 403, 'FORBIDDEN'],
  ['INVITATION_ROLE_FORBIDDEN', 403, 'FORBIDDEN'],
  ['ROLE_NOT_FOUND', 400, 'VALIDATION_ERROR'],
  ['SINGLE_ROLE_REQUIRED', 400, 'VALIDATION_ERROR'],
])('邀请校验保留 %s 的 HTTP 错误映射', async (code, status, responseCode) => {
  assertRole.mockRejectedValue(new APIError('BAD_REQUEST', { code }));
  const tx = {} as TenantTx;
  const submit = vi.fn(
    async (
      _context: TenantContext,
      _input: unknown,
      _key: string,
      _type: string,
      validate: (tx: TenantTx) => Promise<void>,
    ) => validate(tx),
  );
  const runtime = {
    invitationIpHash: vi.fn(() => 'ip-hash'),
  } as unknown as AuthRuntime;
  const service = new OrganizationTaskSubmission(
    { submit } as unknown as BusinessTasks,
    runtime,
  );
  await expect(
    service.importInvitations(context, input, 'key', '127.0.0.1'),
  ).rejects.toMatchObject({ status, response: { code: responseCode } });
  expect(submit).toHaveBeenCalledWith(
    context,
    { ...input, sourceIpHash: 'ip-hash' },
    'key',
    'invitations.import',
    expect.any(Function),
  );
  expect(executor).toHaveBeenCalledWith(tx);
  expect(assertRole).toHaveBeenCalledWith(
    tx,
    'organization',
    'actor',
    'member',
  );
});
