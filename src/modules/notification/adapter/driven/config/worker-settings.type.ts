import type { RetryPolicy } from '@/modules/notification/domain/delivery/retry-policy';
import type { WorkerSettingsAdapter } from '@/modules/notification/adapter/driven/config/worker-settings.adapter';
import {
  MockApiSettings,
  RecipientDirectorySettings,
} from '@/modules/notification/adapter/driven/mock-api/mock-api.type';
import { RateLimiterSettings } from '@/modules/notification/adapter/driven/persistence/rate-limiter/postgres-rate-limiter.type';
import { Env } from '@/shared/config/env.type';
import { DurationMs } from '@/shared/domain/duration.type';

export type WorkerEnv = Pick<
  Env,
  | 'MOCK_API_URL'
  | 'DISPATCH_MAX_REQUEST_MS'
  | 'DISPATCH_LEASE_MS'
  | 'RECONCILE_DELAY_MS'
  | 'RETRY_MAX_ATTEMPTS'
  | 'RETRY_BASE_DELAY_MS'
  | 'RETRY_MAX_DELAY_MS'
  | 'LOOKUP_RETRY_MAX_ATTEMPTS'
  | 'LOOKUP_RETRY_BASE_DELAY_MS'
  | 'LOOKUP_RETRY_MAX_DELAY_MS'
  | 'UNCONFIRMED_AFTER_MS'
  | 'USER_PAGE_LIMIT'
  | 'RATE_LIMIT_INTERVAL_MS'
>;

export interface DeliverySettingsValues {
  readonly leaseMs: DurationMs;
  readonly maxRequestMs: DurationMs;
  readonly reconcileDelayMs: DurationMs;
  readonly retryPolicy: RetryPolicy;
  readonly lookupRetryPolicy: RetryPolicy;
  readonly unconfirmedAfterMs: DurationMs;
}

export interface WorkerSettings {
  readonly deliverySettings: WorkerSettingsAdapter;
  readonly mockApi: MockApiSettings;
  readonly recipientDirectory: RecipientDirectorySettings;
  readonly rateLimiter: RateLimiterSettings;
}
