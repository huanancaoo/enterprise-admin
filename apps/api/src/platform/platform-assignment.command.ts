import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { CommandRunner, Option, SubCommand } from 'nest-commander';
import {
  managePlatformAssignment,
  type PlatformRole,
} from '@workspace/database/platform-assignment-admin';

interface AssignmentOptions {
  userId: string;
  role: PlatformRole;
  reason: string;
}

function requireUserId(value: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new Error('--user-id must be an exact UUID');
  }
  return value;
}

function requireRole(value: string): PlatformRole {
  if (value !== 'platform_admin' && value !== 'platform_auditor') {
    throw new Error('--role must be platform_admin or platform_auditor');
  }
  return value;
}

function requireReason(value: string): string {
  const reason = value.trim();
  if (!reason) throw new Error('--reason must not be empty');
  return reason;
}

async function withDeploymentPool<T>(
  run: (pool: Pool) => Promise<T>,
): Promise<T> {
  const connectionString = process.env.PLATFORM_ASSIGNMENT_DATABASE_URL;
  if (!connectionString)
    throw new Error('PLATFORM_ASSIGNMENT_DATABASE_URL is required');
  const pool = new Pool({ connectionString });
  try {
    return await run(pool);
  } finally {
    await pool.end();
  }
}

abstract class PlatformAssignmentActionCommand extends CommandRunner {
  abstract readonly action: 'grant' | 'revoke';

  async run(
    _passedParams: string[],
    options: AssignmentOptions,
  ): Promise<void> {
    await withDeploymentPool((pool) =>
      managePlatformAssignment(pool, this.action, options),
    );
    process.stdout.write(
      this.action + ' ' + options.userId + ' ' + options.role + '\n',
    );
  }

  @Option({
    flags: '--user-id <userId>',
    required: true,
    description: '精确用户 UUID',
  })
  parseUserId(value: string): string {
    return requireUserId(value);
  }

  @Option({
    flags: '--role <role>',
    required: true,
    description: 'platform_admin 或 platform_auditor',
  })
  parseRole(value: string): PlatformRole {
    return requireRole(value);
  }

  @Option({
    flags: '--reason <reason>',
    required: true,
    description: '授权审计原因',
  })
  parseReason(value: string): string {
    return requireReason(value);
  }
}

@SubCommand({ name: 'grant', description: '授予或更改平台任职' })
@Injectable()
export class PlatformAssignmentGrantCommand extends PlatformAssignmentActionCommand {
  readonly action = 'grant' as const;
}

@SubCommand({ name: 'revoke', description: '撤销平台任职' })
@Injectable()
export class PlatformAssignmentRevokeCommand extends PlatformAssignmentActionCommand {
  readonly action = 'revoke' as const;
}
