import { Module, type DynamicModule } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { ProjectExchangeController } from './project-exchange.controller';
import { ProjectFiles } from './project-files';
import { ProjectFilesController } from './project-files.controller';
import { Projects } from './projects';
import { ProjectsController } from './projects.controller';

@Module({
  imports: [AuthorizationModule, TenancyModule],
  controllers: [
    ProjectExchangeController,
    ProjectsController,
    ProjectFilesController,
  ],
  providers: [Projects, ProjectFiles],
})
export class ProjectsModule {
  static forRoot(tasks: DynamicModule): DynamicModule {
    return { module: ProjectsModule, imports: [tasks] };
  }
}
