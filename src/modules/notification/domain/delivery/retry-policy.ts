import { JitterRatio } from '@/modules/notification/domain/delivery/delivery.type';
import {
  RetryPolicyCreation,
  RetryPolicyOptions,
} from '@/modules/notification/domain/delivery/retry-policy.type';
import { DurationPredicates } from '@/shared/domain/duration.predicate';
import { DurationMs } from '@/shared/domain/duration.type';

export class RetryPolicy {
  private constructor(private readonly options: RetryPolicyOptions) {}

  static create(options: Readonly<RetryPolicyOptions>): RetryPolicyCreation {
    const { maxAttempts, baseDelayMs, maxDelayMs }: Readonly<RetryPolicyOptions> = options;
    if (baseDelayMs > maxDelayMs) {
      return {
        kind: 'rejected',
        error: { code: 'BASE_DELAY_EXCEEDS_MAX', baseDelayMs, maxDelayMs },
      };
    }
    return { kind: 'created', policy: new RetryPolicy({ maxAttempts, baseDelayMs, maxDelayMs }) };
  }

  isExhausted(attempts: number): boolean {
    return attempts >= this.options.maxAttempts;
  }

  delayFor(attempts: number, jitter: JitterRatio): DurationMs {
    const { baseDelayMs, maxDelayMs }: RetryPolicyOptions = this.options;
    const exponent: number = Math.max(0, attempts - 1);
    const capped: number = Math.min(maxDelayMs, baseDelayMs * 2 ** exponent);
    const half: number = capped / 2;
    const delay: number = Math.max(1, Math.floor(half + half * jitter));
    return DurationPredicates.isDurationMs(delay) ? delay : maxDelayMs;
  }
}
