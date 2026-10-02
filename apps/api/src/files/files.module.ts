import { DynamicModule, Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { FilesRuntime } from './files-runtime';
import { FileContent } from './file-content';
import { FileContentController } from './file-content.controller';
import { Files } from './files';
import { FilesController } from './files.controller';
import { FileMaintenance } from './file-maintenance';
import { FileWrites } from './file-writes';
import { FilePathWrites } from './file-path-writes';
import { FilePathsController } from './file-paths.controller';
import { FileWriteExecutor } from './file-write-executor';
import { FileUploads } from './file-uploads';
import { FileUploadsController } from './file-uploads.controller';
import { FileOverwrites } from './file-overwrites';

@Module({})
export class FilesModule {
  static forRoot(runtime: FilesRuntime): DynamicModule {
    return {
      module: FilesModule,
      imports: [AuthorizationModule, TenancyModule],
      controllers: [
        FilesController,
        FileContentController,
        FileUploadsController,
        FilePathsController,
      ],
      providers: [
        { provide: FilesRuntime, useValue: runtime },
        Files,
        FileContent,
        FileMaintenance,
        FileWrites,
        FilePathWrites,
        FileWriteExecutor,
        FileUploads,
        FileOverwrites,
      ],
    };
  }
}
