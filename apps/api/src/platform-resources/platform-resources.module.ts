import { type DynamicModule, Global, Module } from '@nestjs/common';
import { AuthRuntime } from '../identity/auth-runtime';
import { FilesRuntime } from '../files/files-runtime';
import { PlatformResources } from './platform-resources';

@Global()
@Module({})
export class PlatformResourcesModule {
  static forRoot(files: FilesRuntime): DynamicModule {
    return {
      module: PlatformResourcesModule,
      providers: [
        {
          provide: PlatformResources,
          // 物理驱动由 FilesModule 关闭；本模块只复用实例，不能重复注册生命周期。
          useFactory: (runtime: AuthRuntime) =>
            new PlatformResources(runtime, files),
          inject: [AuthRuntime],
        },
      ],
      exports: [PlatformResources],
    };
  }
}
