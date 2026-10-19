import { type DynamicModule, Module } from '@nestjs/common';
import type { WorkerConfig } from '@workspace/jobs';
import type { FilesRuntime } from '../../files/files-runtime';
import { AuthRuntime } from '../../identity/auth-runtime';
import { PlatformAccessModule } from '../platform-access.module';
import { PlatformTasks } from '../tasks/platform-tasks';
import { readMonitorConfig } from './config';
import { PlatformMonitorController } from './controller';
import { PlatformMonitorService } from './service';

@Module({
  imports: [PlatformAccessModule],
  controllers: [PlatformMonitorController],
  exports: [PlatformMonitorService],
})
export class PlatformMonitorModule {
  static forRoot(
    tasks: DynamicModule,
    worker: WorkerConfig,
    files: FilesRuntime,
  ): DynamicModule {
    return {
      module: PlatformMonitorModule,
      imports: [tasks],
      providers: [
        {
          provide: PlatformMonitorService,
          // FilesModule 独占存储生命周期；监控复用同一实例，不注册第二份关闭钩子。
          useFactory: (runtime: AuthRuntime, tasks: PlatformTasks) =>
            new PlatformMonitorService(runtime, files, tasks, {
              jobs: worker,
              monitor: readMonitorConfig(process.env),
            }),
          inject: [AuthRuntime, PlatformTasks],
        },
      ],
    };
  }
}
