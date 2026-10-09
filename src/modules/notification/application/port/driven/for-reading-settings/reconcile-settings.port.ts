import { RetryPolicy } from '@/modules/notification/domain/delivery/retry-policy';
import { DurationMs } from '@/shared/domain/duration.type';

export abstract class ReconcileSettingsPort {
  abstract readonly retryPolicy: RetryPolicy;

  abstract readonly lookupRetryPolicy: RetryPolicy;

  abstract readonly unconfirmedAfterMs: DurationMs;
}
