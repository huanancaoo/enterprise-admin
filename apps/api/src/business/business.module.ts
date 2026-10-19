import { Module, type DynamicModule } from '@nestjs/common';
import type { WorkerConfig } from '@workspace/jobs';
import { AuthorizationModule } from '../authorization/authorization.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { businessWorkerConfig } from './business-config';
import { BusinessTaskReadGuard } from './business-task-read.guard';
import { BusinessTasks } from './business-tasks';
import { BusinessController } from './business.controller';
@Module({
  imports: [TenancyModule, AuthorizationModule],
  controllers: [BusinessController],
  providers: [BusinessTasks, BusinessTaskReadGuard],
  exports: [BusinessTasks],
})
export class BusinessModule {
  static forRoot(config: WorkerConfig): DynamicModule {
    return {
      module: BusinessModule,
      providers: [{ provide: businessWorkerConfig, useValue: config }],
    };
  }
}
