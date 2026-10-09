import { RetryPolicy } from '@/modules/notification/domain/delivery/retry-policy';
import { DurationMs } from '@/shared/domain/duration.type';

export interface DispatchSettings {
  readonly leaseMs: DurationMs;
  readonly maxRequestMs: DurationMs;
  readonly reconcileDelayMs: DurationMs;
  readonly retryPolicy: RetryPolicy;
}

export interface ReconcileSettings {
  readonly retryPolicy: RetryPolicy;
  readonly lookupRetryPolicy: RetryPolicy;
  readonly unconfirmedAfterMs: DurationMs;
  readonly leaseMs: DurationMs;
}

export type LeaseRecoverySettings = Pick<DispatchSettings, 'reconcileDelayMs'>;
