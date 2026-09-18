import { DynamicModule, Module } from '@nestjs/common';
import { EmailRuntime } from './email-runtime';

@Module({})
export class EmailModule {
  static forRoot(email: EmailRuntime): DynamicModule {
    return {
      module: EmailModule,
      providers: [{ provide: EmailRuntime, useValue: email }],
      exports: [EmailRuntime],
    };
  }
}
