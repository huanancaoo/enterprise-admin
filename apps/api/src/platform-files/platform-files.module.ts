import { DynamicModule, Global, Module } from '@nestjs/common';
import { AuthRuntime } from '../identity/auth-runtime';
import { FilesRuntime } from '../files/files-runtime';
import { PlatformAccessModule } from '../platform/platform-access.module';
import { PlatformFiles } from './platform-files';
import { PlatformFilesController } from './platform-files.controller';

@Global()
@Module({})
export class PlatformFilesModule {
  static forRoot(files: FilesRuntime): DynamicModule {
    return {
      module: PlatformFilesModule,
      imports: [PlatformAccessModule],
      controllers: [PlatformFilesController],
      providers: [
        {
          provide: PlatformFiles,
          useFactory: (identity: AuthRuntime) =>
            new PlatformFiles(identity, files),
          inject: [AuthRuntime],
        },
      ],
      exports: [PlatformFiles],
    };
  }
}
