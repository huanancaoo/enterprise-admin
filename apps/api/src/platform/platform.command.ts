import { Injectable } from '@nestjs/common';
import { CommandRunner, RootCommand, SubCommand } from 'nest-commander';
import { PlatformAdminCreateCommand } from './platform-admin-create.command';

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

@SubCommand({
  name: 'platform',
  description: '平台',
  subCommands: [PlatformAdminCommand],
})
@Injectable()
export class PlatformCommand extends CommandRunner {
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

@RootCommand({
  name: 'ea',
  subCommands: [PlatformCommand],
})
@Injectable()
export class EnterpriseAdminCommand extends CommandRunner {
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
