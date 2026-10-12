import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { shutdownTelemetry } from '@workspace/observability';

@Injectable()
export class TelemetryRuntime implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    // 业务 provider 已完成 destroy、HTTP 已排空后再导出最后一批事件。
    await shutdownTelemetry();
  }
}
