import { Module, type DynamicModule } from '@nestjs/common';
import type { WorkerConfig } from '@workspace/jobs';
import { TenancyModule } from '../tenancy/tenancy.module';
import { BusinessController } from './business.controller';
import { BusinessTasks } from './business-tasks';
import { BusinessTaskReadGuard } from './business-task-read.guard';
import { businessWorkerConfig } from './business-config';
import { AuthorizationModule } from '../authorization/authorization.module';
@Module({
  imports: [TenancyModule, AuthorizationModule],
  controllers: [BusinessController],
  providers: [BusinessTasks, BusinessTaskReadGuard],
})
export class BusinessModule {
  static forRoot(config: WorkerConfig): DynamicModule {
    return {
      module: BusinessModule,
      providers: [{ provide: businessWorkerConfig, useValue: config }],
    };
  }
}
