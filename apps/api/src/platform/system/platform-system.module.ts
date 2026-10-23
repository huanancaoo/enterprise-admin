import { Module } from '@nestjs/common';
import { PlatformAccessModule } from '../platform-access.module';
import { PlatformDepartmentsController } from './departments.controller';
import { PlatformDictionariesController } from './dictionaries.controller';
import { PlatformEmployeesController } from './employees.controller';
import { PlatformParametersController } from './parameters.controller';
import { PlatformSystem } from './platform-system';
import { PlatformPostsController } from './posts.controller';
import { PlatformRolesController } from './roles.controller';

@Module({
  imports: [PlatformAccessModule],
  controllers: [
    PlatformEmployeesController,
    PlatformDictionariesController,
    PlatformParametersController,
    PlatformRolesController,
    PlatformDepartmentsController,
    PlatformPostsController,
  ],
  providers: [PlatformSystem],
  exports: [PlatformSystem],
})
export class PlatformSystemModule {}
