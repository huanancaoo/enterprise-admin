import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { Projects } from './projects';
import { ProjectsController } from './projects.controller';

@Module({
  imports: [AuthorizationModule, TenancyModule],
  controllers: [ProjectsController],
  providers: [Projects],
})
export class ProjectsModule {}
