import { RetryPolicy } from '@/modules/notification/domain/delivery/retry-policy';
import { DurationMs } from '@/shared/domain/duration.type';

export abstract class DispatchSettingsPort {
  abstract readonly leaseMs: DurationMs;

  abstract readonly maxRequestMs: DurationMs;

  abstract readonly reconcileDelayMs: DurationMs;

  abstract readonly retryPolicy: RetryPolicy;
}
