import { DynamicModule, Module } from '@nestjs/common';
import { AuthRuntime } from './auth-runtime';
import { IdentityService } from './identity.service';

@Module({})
export class IdentityModule {
  static forRoot(runtime: AuthRuntime): DynamicModule {
    // AuthRuntime 必须在 Nest 容器外构造（Better Auth 邮件钩子需要连接池），且被多个 feature 注入。
    return {
      module: IdentityModule,
      global: true,
      providers: [{ provide: AuthRuntime, useValue: runtime }, IdentityService],
      exports: [AuthRuntime, IdentityService],
    };
  }
}
