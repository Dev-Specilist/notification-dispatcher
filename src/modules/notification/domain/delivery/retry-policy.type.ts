import type { RetryPolicy } from '@/modules/notification/domain/delivery/retry-policy';
import { AttemptLimit } from '@/modules/notification/domain/delivery/delivery.type';
import { DurationMs } from '@/shared/domain/duration.type';

export interface RetryPolicyOptions {
  readonly maxAttempts: AttemptLimit;
  readonly baseDelayMs: DurationMs;
  readonly maxDelayMs: DurationMs;
}

export interface BaseDelayExceedsMax {
  readonly code: 'BASE_DELAY_EXCEEDS_MAX';
  readonly baseDelayMs: DurationMs;
  readonly maxDelayMs: DurationMs;
}

export interface RetryPolicyCreated {
  readonly kind: 'created';
  readonly policy: RetryPolicy;
}

export interface RetryPolicyRejected {
  readonly kind: 'rejected';
  readonly error: BaseDelayExceedsMax;
}

export type RetryPolicyCreation = RetryPolicyCreated | RetryPolicyRejected;
