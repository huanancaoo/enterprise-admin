import { type DynamicModule, Module } from '@nestjs/common';
import type { WorkerConfig } from '@workspace/jobs';
import { PlatformTasks, PLATFORM_TASK_CONFIG } from './platform-tasks';
import { PlatformTasksController } from './platform-tasks.controller';
import { PlatformAccessService } from './platform-access.service';
import { PlatformGuard } from './platform.guard';

@Module({})
export class PlatformTasksModule {
  static forRoot(worker: WorkerConfig, encryptionKey: Buffer): DynamicModule {
    return {
      module: PlatformTasksModule,
      controllers: [PlatformTasksController],
      providers: [
        PlatformAccessService,
        PlatformGuard,
        PlatformTasks,
        { provide: PLATFORM_TASK_CONFIG, useValue: { worker, encryptionKey } },
      ],
      exports: [PlatformTasks],
    };
  }
}
