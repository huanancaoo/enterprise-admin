import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createDatabase } from '@workspace/database';

@Injectable()
export class PlatformRuntime implements OnModuleDestroy {
  readonly pool: ReturnType<typeof createDatabase>['pool'];

  constructor(databaseURL: string) {
    this.pool = createDatabase(databaseURL).pool;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
