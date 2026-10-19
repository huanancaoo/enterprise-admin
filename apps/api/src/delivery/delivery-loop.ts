type DeliveryLoopOptions = {
  intervalMs: () => number;
  dispatch: () => Promise<void>;
  onTickError: (error: unknown) => void;
};

// 关停时等在途一轮结束，避免连接池先关、租约无法结算。
export class DeliveryLoop {
  private stopped = true;
  private timer: NodeJS.Timeout | undefined;
  private active: Promise<void> | undefined;

  constructor(private readonly options: DeliveryLoopOptions) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.active;
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      this.active = this.options
        .dispatch()
        .catch((error: unknown) => {
          this.options.onTickError(error);
        })
        .finally(() => {
          this.active = undefined;
          if (!this.stopped) this.schedule(this.options.intervalMs());
        });
    }, delay);
  }
}
