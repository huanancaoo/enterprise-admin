import { DynamicModule, Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { FilesRuntime } from './files-runtime';
import { FileContent } from './file-content';
import { FileContentController } from './file-content.controller';
import { Files } from './files';
import { FileOperationReads } from './file-operation-reads';
import { FilesController } from './files.controller';
import { FileMaintenance } from './file-maintenance';
import { FileWrites } from './file-writes';
import { FilePathWrites } from './file-path-writes';
import { FilePathsController } from './file-paths.controller';
import { FileBatches } from './file-batches';
import { FileBatchesController } from './file-batches.controller';
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
        FileBatchesController,
      ],
      providers: [
        { provide: FilesRuntime, useValue: runtime },
        Files,
        FileOperationReads,
        FileContent,
        FileMaintenance,
        FileWrites,
        FilePathWrites,
        FileBatches,
        FileWriteExecutor,
        FileUploads,
        FileOverwrites,
      ],
    };
  }
}
