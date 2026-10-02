import { DynamicModule, Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { FilesRuntime } from './files-runtime';
import { Files } from './files';
import { FilesController } from './files.controller';

@Module({})
export class FilesModule {
  static forRoot(runtime: FilesRuntime): DynamicModule {
    return {
      module: FilesModule,
      imports: [AuthorizationModule, TenancyModule],
      controllers: [FilesController],
      providers: [{ provide: FilesRuntime, useValue: runtime }, Files],
    };
  }
}
