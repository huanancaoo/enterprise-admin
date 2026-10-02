import { type DynamicModule, Module } from '@nestjs/common';
import { AuthRuntime } from '../identity/auth-runtime';
import { FilesRuntime } from '../files/files-runtime';
import { PersonalMedia } from './personal-media';
import { PersonalMediaController } from './personal-media.controller';
import { PersonalMediaGuard } from './personal-media.guard';

@Module({})
export class PersonalMediaModule {
  static forRoot(files: FilesRuntime): DynamicModule {
    return {
      module: PersonalMediaModule,
      controllers: [PersonalMediaController],
      providers: [
        PersonalMediaGuard,
        {
          provide: PersonalMedia,
          // FilesModule 独占共享 runtime 的 shutdown，不能重复注册同一 Pool 的生命周期。
          useFactory: (runtime: AuthRuntime) =>
            new PersonalMedia(runtime, files),
          inject: [AuthRuntime],
        },
      ],
    };
  }
}
