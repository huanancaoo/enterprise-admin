import { StorageError } from './storage/storage';

// 租约截止计时使用数据库返回的剩余时长，不要求数据库与主机时钟同步。
export class FileLease {
  readonly signal: AbortSignal;
  private readonly controller = new AbortController();
  private deadline?: NodeJS.Timeout;
  private timer?: NodeJS.Timeout;
  private renewal?: Promise<void>;
  private stopped = false;

  constructor(
    remainingMilliseconds: number,
    scopeSignal: AbortSignal,
    private readonly renew: () => Promise<number>,
  ) {
    this.signal = AbortSignal.any([scopeSignal, this.controller.signal]);
    this.setDeadline(remainingMilliseconds);
    this.scheduleRenewal();
  }

  private setDeadline(remainingMilliseconds: number): void {
    if (this.deadline) clearTimeout(this.deadline);
    if (remainingMilliseconds <= 0) {
      this.controller.abort(new StorageError('STORAGE_UNAVAILABLE'));
      return;
    }
    this.deadline = setTimeout(() => {
      this.controller.abort(new StorageError('STORAGE_UNAVAILABLE'));
    }, remainingMilliseconds);
  }

  private scheduleRenewal(): void {
    if (this.stopped || this.signal.aborted) return;
    this.timer = setTimeout(() => {
      this.renewal = this.renew()
        .then((remaining) => {
          if (!this.stopped) {
            this.setDeadline(remaining);
            this.scheduleRenewal();
          }
        })
        .catch((error: unknown) => this.controller.abort(error));
    }, 30_000);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.deadline) clearTimeout(this.deadline);
    await this.renewal;
  }
}
