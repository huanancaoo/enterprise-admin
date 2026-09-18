import { Module } from '@nestjs/common';
import { PlatformController } from './platform.controller';
import { PlatformGuard } from './platform.guard';

@Module({
  controllers: [PlatformController],
  providers: [PlatformGuard],
})
export class PlatformModule {}
