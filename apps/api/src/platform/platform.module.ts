import { DynamicModule, Module } from '@nestjs/common';
import { PlatformAccessService } from './platform-access.service';
import { PlatformController } from './platform.controller';
import { PlatformGuard } from './platform.guard';
import { PlatformRuntime } from './platform-runtime';

@Module({})
export class PlatformModule {
  static forRoot(databaseURL: string): DynamicModule {
    return {
      module: PlatformModule,
      controllers: [PlatformController],
      providers: [
        {
          provide: PlatformRuntime,
          useFactory: () => new PlatformRuntime(databaseURL),
        },
        PlatformAccessService,
        PlatformGuard,
      ],
    };
  }
}
