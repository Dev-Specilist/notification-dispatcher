import { AttemptLimit, JitterRatio } from '@/modules/notification/domain/delivery/delivery.type';
import { DurationMs } from '@/shared/domain/duration.type';

export interface RetryPolicyOptions {
  readonly maxAttempts: AttemptLimit;
  readonly baseDelayMs: DurationMs;
  readonly maxDelayMs: DurationMs;
}

export class RetryPolicy {
  constructor(private readonly options: Readonly<RetryPolicyOptions>) {}

  isExhausted(attempts: number): boolean {
    return attempts >= this.options.maxAttempts;
  }

  delayFor(attempts: number, jitter: JitterRatio): number {
    const { baseDelayMs, maxDelayMs }: Readonly<RetryPolicyOptions> = this.options;
    const exponent: number = Math.max(0, attempts - 1);
    const capped: number = Math.min(maxDelayMs, baseDelayMs * 2 ** exponent);
    const half: number = capped / 2;
    return Math.max(1, Math.floor(half + half * jitter));
  }
}
