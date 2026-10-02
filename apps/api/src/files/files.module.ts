import { DynamicModule, Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { FilesRuntime } from './files-runtime';
import { FileContent } from './file-content';
import { FileContentController } from './file-content.controller';
import { Files } from './files';
import { FilesController } from './files.controller';
import { FileMaintenance } from './file-maintenance';

@Module({})
export class FilesModule {
  static forRoot(runtime: FilesRuntime): DynamicModule {
    return {
      module: FilesModule,
      imports: [AuthorizationModule, TenancyModule],
      controllers: [FilesController, FileContentController],
      providers: [
        { provide: FilesRuntime, useValue: runtime },
        Files,
        FileContent,
        FileMaintenance,
      ],
    };
  }
}
