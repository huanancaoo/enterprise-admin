#!/usr/bin/env node
import { Module } from '@nestjs/common';
import { CommandFactory } from 'nest-commander';
import { PlatformAdminCreateCommand } from './platform-admin-create.command';
import {
  EnterpriseAdminCommand,
  PlatformAdminCommand,
  PlatformCommand,
} from './platform.command';

@Module({
  providers: [
    EnterpriseAdminCommand,
    PlatformCommand,
    PlatformAdminCommand,
    PlatformAdminCreateCommand,
  ],
})
class ConsoleModule {}

async function bootstrap() {
  await CommandFactory.run(ConsoleModule, {
    cliName: 'ea',
  });
}

void bootstrap();
