import { Injectable } from '@nestjs/common';
import { createPlatformAdmin } from '@workspace/database/platform-admin';
import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { AuthRuntime, readAuthConfig } from './auth-runtime';
import { noopAuthEmailHooks } from '@workspace/database/auth';

interface PlatformAdminCreateOptions {
  email: string;
  password: string;
  name: string;
}

@SubCommand({
  name: 'create',
  description: '创建平台管理员',
})
@Injectable()
export class PlatformAdminCreateCommand extends CommandRunner {
  override setCommand(
    command: Parameters<CommandRunner['setCommand']>[0],
  ): this {
    command.usage('--email <email> --password <password> --name <name>');
    command.helpOption('-h, --help', '显示帮助');
    return super.setCommand(command);
  }

  async run(
    _passedParams: string[],
    options: PlatformAdminCreateOptions,
  ): Promise<void> {
    const runtime = new AuthRuntime(
      readAuthConfig(process.env),
      () => noopAuthEmailHooks,
    );
    try {
      const { userId } = await createPlatformAdmin(
        runtime.auth,
        runtime.pool,
        options,
      );
      process.stdout.write(`${userId}\n`);
    } finally {
      await runtime.onApplicationShutdown();
    }
  }

  @Option({
    flags: '--email <email>',
    required: true,
    description: '登录邮箱',
  })
  parseEmail(value: string): string {
    return value;
  }

  @Option({
    flags: '--password <password>',
    required: true,
    description: '登录密码',
  })
  parsePassword(value: string): string {
    return value;
  }

  @Option({
    flags: '--name <name>',
    required: true,
    description: '显示名称',
  })
  parseName(value: string): string {
    return value;
  }
}
