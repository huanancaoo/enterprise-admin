#!/usr/bin/env node
import { Module } from '@nestjs/common';
import { CommandFactory } from 'nest-commander';
import {
  PlatformAssignmentGrantCommand,
  PlatformAssignmentRevokeCommand,
} from './platform/platform-assignment.command';
import {
  EnterpriseAdminCommand,
  PlatformAssignmentCommand,
  PlatformCommand,
} from './platform/platform.command';

@Module({
  providers: [
    EnterpriseAdminCommand,
    PlatformCommand,
    PlatformAssignmentCommand,
    PlatformAssignmentGrantCommand,
    PlatformAssignmentRevokeCommand,
  ],
})
class ConsoleModule {}

async function bootstrap() {
  await CommandFactory.run(ConsoleModule, {
    cliName: 'ea',
    // nest-commander 默认把命令错误写入 stderr 后以退出码 0 结束；
    // CI 与脚本依赖非零退出码感知失败，必须显式标记。
    serviceErrorHandler: (error) => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    },
  });
}

void bootstrap();
