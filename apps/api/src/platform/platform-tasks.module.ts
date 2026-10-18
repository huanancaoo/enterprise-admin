import { PlatformSchedules } from './schedules/service';
import { PlatformSchedulesController } from './schedules/controller';
import { AuthRuntime } from '../identity/auth-runtime';
import type { FilesRuntime } from '../files/files-runtime';
import { PlatformMonitorService } from './monitor/service';
import { PlatformMonitorController } from './monitor/controller';
import { readMonitorConfig } from './monitor/config';
import { type DynamicModule, Module } from '@nestjs/common';
import type { WorkerConfig } from '@workspace/jobs';
import { PlatformTasks, PLATFORM_TASK_CONFIG } from './platform-tasks';
import { PlatformTasksController } from './platform-tasks.controller';
import { PlatformAccessService } from './platform-access.service';
import { PlatformGuard } from './platform.guard';
import { PlatformSystem } from './platform-system';

@Module({})
export class PlatformTasksModule {
  static forRoot(
    worker: WorkerConfig,
    encryptionKey: Buffer,
    files: FilesRuntime,
  ): DynamicModule {
    return {
      module: PlatformTasksModule,
      controllers: [
        PlatformTasksController,
        PlatformMonitorController,
        PlatformSchedulesController,
      ],
      providers: [
        PlatformAccessService,
        PlatformGuard,
        PlatformTasks,
        PlatformSchedules,
        {
          provide: PlatformMonitorService,
          // FilesModule独占共享存储的生命周期；监控只使用它，不重复注册关闭钩子。
          useFactory: (runtime: AuthRuntime, tasks: PlatformTasks) =>
            new PlatformMonitorService(runtime, files, tasks, {
              jobs: worker,
              monitor: readMonitorConfig(process.env),
            }),
          inject: [AuthRuntime, PlatformTasks],
        },
        PlatformSystem,
        { provide: PLATFORM_TASK_CONFIG, useValue: { worker, encryptionKey } },
      ],
      exports: [PlatformTasks, PlatformSchedules],
    };
  }
}
