import { Injectable } from '@nestjs/common';
import { authPasswordPolicy } from '@workspace/database';
import { createPlatformAdmin } from '@workspace/database/platform-assignment-admin';
import { readFileSync } from 'node:fs';
import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Pool } from 'pg';
import { z } from 'zod';

interface CreateAdminOptions {
  email: string;
  name: string;
  reason: string;
  passwordStdin: boolean;
}

const createAdminSchema = z.object({
  email: z
    .string()
    .trim()
    .pipe(z.email())
    .transform((email) => email.toLowerCase()),
  name: z.string().trim().min(1),
  reason: z.string().trim().min(1),
  password: z
    .string()
    .min(authPasswordPolicy.minPasswordLength)
    .max(authPasswordPolicy.maxPasswordLength),
});

@SubCommand({ name: 'create', description: '创建邮箱已验证的平台管理员' })
@Injectable()
export class PlatformAdminCreateCommand extends CommandRunner {
  async run(
    _passedParams: string[],
    options: CreateAdminOptions,
  ): Promise<void> {
    const connectionString = process.env.PLATFORM_ASSIGNMENT_DATABASE_URL;
    if (!connectionString)
      throw new Error('PLATFORM_ASSIGNMENT_DATABASE_URL is required');
    if (process.stdin.isTTY)
      throw new Error('--password-stdin requires piped input');
    // 密码只经标准输入传入，避免进入进程参数；仅移除管道附带的末尾换行。
    const password = readFileSync(0, 'utf8').replace(/\r?\n$/, '');
    const input = createAdminSchema.parse({ ...options, password });
    const pool = new Pool({ connectionString });
    try {
      const userId = await createPlatformAdmin(pool, input);
      process.stdout.write(
        JSON.stringify({ userId, email: input.email, role: 'platform_admin' }) +
          '\n',
      );
    } finally {
      await pool.end();
    }
  }

  @Option({ flags: '--email <email>', required: true, description: '账号邮箱' })
  parseEmail(value: string): string {
    return value;
  }

  @Option({
    flags: '--name <name>',
    required: true,
    description: '账号显示名称',
  })
  parseName(value: string): string {
    return value;
  }

  @Option({
    flags: '--reason <reason>',
    required: true,
    description: '创建与授权的审计原因',
  })
  parseReason(value: string): string {
    return value;
  }

  @Option({
    flags: '--password-stdin',
    required: true,
    description: '从标准输入读取密码',
  })
  parsePasswordStdin(): boolean {
    return true;
  }
}

@SubCommand({
  name: 'admin',
  description: '平台管理员',
  subCommands: [PlatformAdminCreateCommand],
})
@Injectable()
export class PlatformAdminCommand extends CommandRunner {
  override setCommand(
    command: Parameters<CommandRunner['setCommand']>[0],
  ): this {
    command.helpOption('-h, --help', '显示帮助');
    return super.setCommand(command);
  }

  run(): Promise<void> {
    this.command.help();
  }
}
