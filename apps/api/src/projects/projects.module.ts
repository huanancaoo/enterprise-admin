import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { Projects } from './projects';
import { ProjectFiles } from './project-files';
import { ProjectFilesController } from './project-files.controller';
import { ProjectsController } from './projects.controller';

@Module({
  imports: [AuthorizationModule, TenancyModule],
  controllers: [ProjectsController, ProjectFilesController],
  providers: [Projects, ProjectFiles],
})
export class ProjectsModule {}
