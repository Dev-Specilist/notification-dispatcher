import {
  DispatchSettings,
  LeaseRecoverySettings,
  ReconcileSettings,
} from '@/modules/notification/application/service/delivery/delivery-settings.type';
import { ExpansionSettings } from '@/modules/notification/application/service/expansion/expansion-settings.type';
import {
  MockApiSettings,
  RecipientDirectorySettings,
} from '@/modules/notification/adapter/driven/mock-api/mock-api.type';
import { RateLimiterSettings } from '@/modules/notification/adapter/driven/persistence/rate-limiter/postgres-rate-limiter.type';
import { Env } from '@/shared/config/env.type';

export type WorkerEnv = Pick<
  Env,
  | 'MOCK_API_URL'
  | 'DISPATCH_MAX_REQUEST_MS'
  | 'DISPATCH_LEASE_MS'
  | 'RECONCILE_DELAY_MS'
  | 'RETRY_MAX_ATTEMPTS'
  | 'RETRY_BASE_DELAY_MS'
  | 'RETRY_MAX_DELAY_MS'
  | 'LOOKUP_RETRY_BASE_DELAY_MS'
  | 'LOOKUP_RETRY_MAX_DELAY_MS'
  | 'UNCONFIRMED_AFTER_MS'
  | 'USER_PAGE_LIMIT'
  | 'RATE_LIMIT_INTERVAL_MS'
>;

export type DeliverySettingsValues = DispatchSettings &
  ReconcileSettings &
  LeaseRecoverySettings &
  ExpansionSettings;

export abstract class WorkerSettings {
  abstract readonly deliverySettings: DeliverySettingsValues;
  abstract readonly mockApi: MockApiSettings;
  abstract readonly recipientDirectory: RecipientDirectorySettings;
  abstract readonly rateLimiter: RateLimiterSettings;
}
