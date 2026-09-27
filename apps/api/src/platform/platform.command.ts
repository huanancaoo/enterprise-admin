import { Injectable } from '@nestjs/common';
import { CommandRunner, RootCommand, SubCommand } from 'nest-commander';
import {
  PlatformAssignmentGrantCommand,
  PlatformAssignmentRevokeCommand,
} from './platform-assignment.command';

@SubCommand({
  name: 'assignment',
  description: '平台任职',
  subCommands: [
    PlatformAssignmentGrantCommand,
    PlatformAssignmentRevokeCommand,
  ],
})
@Injectable()
export class PlatformAssignmentCommand extends CommandRunner {
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
  subCommands: [PlatformAssignmentCommand],
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
