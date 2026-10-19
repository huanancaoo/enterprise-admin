import { type DynamicModule, Module } from '@nestjs/common';
import type { WorkerConfig } from '@workspace/jobs';
import { PlatformAccessModule } from '../platform-access.module';
import { PlatformSystemModule } from '../system/platform-system.module';
import { PLATFORM_TASK_CONFIG, PlatformTasks } from './platform-tasks';
import { PlatformTasksController } from './platform-tasks.controller';

@Module({
  imports: [PlatformAccessModule, PlatformSystemModule],
  controllers: [PlatformTasksController],
  providers: [PlatformTasks],
  exports: [PlatformTasks],
})
export class PlatformTasksModule {
  static forRoot(worker: WorkerConfig, encryptionKey: Buffer): DynamicModule {
    return {
      module: PlatformTasksModule,
      providers: [
        { provide: PLATFORM_TASK_CONFIG, useValue: { worker, encryptionKey } },
      ],
    };
  }
}
