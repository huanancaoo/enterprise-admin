import { type DynamicModule, Module } from '@nestjs/common';
import { PlatformAccessModule } from '../platform-access.module';
import { PlatformSchedulesController } from './controller';
import { PlatformSchedules } from './service';

@Module({
  imports: [PlatformAccessModule],
  controllers: [PlatformSchedulesController],
  providers: [PlatformSchedules],
  exports: [PlatformSchedules],
})
export class PlatformSchedulesModule {
  static forRoot(monitor: DynamicModule): DynamicModule {
    return { module: PlatformSchedulesModule, imports: [monitor] };
  }
}
