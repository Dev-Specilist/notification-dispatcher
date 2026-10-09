import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import { AttemptLimit } from '@/modules/notification/domain/delivery/delivery.type';
import { RetryPolicy } from '@/modules/notification/domain/delivery/retry-policy';
import { RetryPolicyCreation } from '@/modules/notification/domain/delivery/retry-policy.type';
import { MockApiPredicates } from '@/modules/notification/adapter/driven/mock-api/mock-api.predicate';
import {
  RequestTimeoutMs,
  UserPageLimit,
} from '@/modules/notification/adapter/driven/mock-api/mock-api.type';
import {
  WorkerEnv,
  WorkerSettings,
} from '@/modules/notification/adapter/driven/config/worker-settings.type';
import { DurationPredicates } from '@/shared/domain/duration.predicate';
import { DurationMs } from '@/shared/domain/duration.type';
import { TypedConfigService } from '@/shared/config/typed-config.service';

type RetryEnvPrefix = 'RETRY' | 'LOOKUP_RETRY';

export class WorkerSettingsFactory {
  private static readonly RATE_LIMITER_NAME: string = 'mock-message-send';

  private static readonly MAX_PERMITS_PER_SECOND: number = 50;

  private static readonly LOOKUP_ATTEMPTS_UNBOUNDED_UNTIL_UNCONFIRMED: number =
    Number.MAX_SAFE_INTEGER;

  private static readonly MIN_EMISSION_INTERVAL_MS: number =
    1_000 / WorkerSettingsFactory.MAX_PERMITS_PER_SECOND;

  static fromConfig(config: TypedConfigService): WorkerSettings {
    return WorkerSettingsFactory.create({
      MOCK_API_URL: config.get('MOCK_API_URL'),
      DISPATCH_MAX_REQUEST_MS: config.get('DISPATCH_MAX_REQUEST_MS'),
      DISPATCH_LEASE_MS: config.get('DISPATCH_LEASE_MS'),
      RECONCILE_DELAY_MS: config.get('RECONCILE_DELAY_MS'),
      RETRY_MAX_ATTEMPTS: config.get('RETRY_MAX_ATTEMPTS'),
      RETRY_BASE_DELAY_MS: config.get('RETRY_BASE_DELAY_MS'),
      RETRY_MAX_DELAY_MS: config.get('RETRY_MAX_DELAY_MS'),
      LOOKUP_RETRY_BASE_DELAY_MS: config.get('LOOKUP_RETRY_BASE_DELAY_MS'),
      LOOKUP_RETRY_MAX_DELAY_MS: config.get('LOOKUP_RETRY_MAX_DELAY_MS'),
      UNCONFIRMED_AFTER_MS: config.get('UNCONFIRMED_AFTER_MS'),
      USER_PAGE_LIMIT: config.get('USER_PAGE_LIMIT'),
      RATE_LIMIT_INTERVAL_MS: config.get('RATE_LIMIT_INTERVAL_MS'),
    });
  }

  static create(env: Readonly<WorkerEnv>): WorkerSettings {
    const maxRequestMs: DurationMs = WorkerSettingsFactory.durationOf(
      'DISPATCH_MAX_REQUEST_MS',
      env.DISPATCH_MAX_REQUEST_MS,
    );
    const leaseMs: DurationMs = WorkerSettingsFactory.durationOf(
      'DISPATCH_LEASE_MS',
      env.DISPATCH_LEASE_MS,
    );
    if (leaseMs <= maxRequestMs) {
      throw new Error(
        `DISPATCH_LEASE_MS(${leaseMs}) must be longer than DISPATCH_MAX_REQUEST_MS(${maxRequestMs}), otherwise no request can start within a lease`,
      );
    }
    const baseUrl: URL = new URL(env.MOCK_API_URL);
    const requestTimeoutMs: RequestTimeoutMs = WorkerSettingsFactory.requestTimeoutOf(maxRequestMs);
    return {
      deliverySettings: {
        leaseMs,
        maxRequestMs,
        reconcileDelayMs: WorkerSettingsFactory.durationOf(
          'RECONCILE_DELAY_MS',
          env.RECONCILE_DELAY_MS,
        ),
        retryPolicy: WorkerSettingsFactory.retryPolicyOf(
          'RETRY',
          WorkerSettingsFactory.attemptLimitOf('RETRY_MAX_ATTEMPTS', env.RETRY_MAX_ATTEMPTS),
          env.RETRY_BASE_DELAY_MS,
          env.RETRY_MAX_DELAY_MS,
        ),
        lookupRetryPolicy: WorkerSettingsFactory.retryPolicyOf(
          'LOOKUP_RETRY',
          WorkerSettingsFactory.attemptLimitOf(
            'LOOKUP_ATTEMPTS_UNBOUNDED_UNTIL_UNCONFIRMED',
            WorkerSettingsFactory.LOOKUP_ATTEMPTS_UNBOUNDED_UNTIL_UNCONFIRMED,
          ),
          env.LOOKUP_RETRY_BASE_DELAY_MS,
          env.LOOKUP_RETRY_MAX_DELAY_MS,
        ),
        unconfirmedAfterMs: WorkerSettingsFactory.durationOf(
          'UNCONFIRMED_AFTER_MS',
          env.UNCONFIRMED_AFTER_MS,
        ),
      },
      mockApi: { baseUrl, requestTimeoutMs },
      recipientDirectory: {
        baseUrl,
        requestTimeoutMs,
        pageLimit: WorkerSettingsFactory.pageLimitOf(env.USER_PAGE_LIMIT),
      },
      rateLimiter: {
        name: WorkerSettingsFactory.RATE_LIMITER_NAME,
        emissionIntervalMs: WorkerSettingsFactory.emissionIntervalOf(env.RATE_LIMIT_INTERVAL_MS),
      },
    };
  }

  private static durationOf(key: string, rawDurationMs: number): DurationMs {
    if (!DurationPredicates.isDurationMs(rawDurationMs)) {
      throw new Error(`${key}(${rawDurationMs}) is not a valid duration`);
    }
    return rawDurationMs;
  }

  private static attemptLimitOf(key: string, rawAttemptLimit: number): AttemptLimit {
    if (!DeliveryPredicates.isAttemptLimit(rawAttemptLimit)) {
      throw new Error(`${key}(${rawAttemptLimit}) is not a valid attempt limit`);
    }
    return rawAttemptLimit;
  }

  private static retryPolicyOf(
    prefix: RetryEnvPrefix,
    maxAttempts: AttemptLimit,
    rawBaseDelayMs: number,
    rawMaxDelayMs: number,
  ): RetryPolicy {
    const creation: RetryPolicyCreation = RetryPolicy.create({
      maxAttempts,
      baseDelayMs: WorkerSettingsFactory.durationOf(`${prefix}_BASE_DELAY_MS`, rawBaseDelayMs),
      maxDelayMs: WorkerSettingsFactory.durationOf(`${prefix}_MAX_DELAY_MS`, rawMaxDelayMs),
    });
    if (creation.kind === 'rejected') {
      throw new Error(
        `${prefix}_BASE_DELAY_MS(${rawBaseDelayMs}) must not exceed ${prefix}_MAX_DELAY_MS(${rawMaxDelayMs})`,
      );
    }
    return creation.policy;
  }

  private static emissionIntervalOf(rawIntervalMs: number): DurationMs {
    const intervalMs: DurationMs = WorkerSettingsFactory.durationOf(
      'RATE_LIMIT_INTERVAL_MS',
      rawIntervalMs,
    );
    if (intervalMs < WorkerSettingsFactory.MIN_EMISSION_INTERVAL_MS) {
      throw new Error(
        `RATE_LIMIT_INTERVAL_MS(${intervalMs}) must be at least ${WorkerSettingsFactory.MIN_EMISSION_INTERVAL_MS} to keep sends at or below ${WorkerSettingsFactory.MAX_PERMITS_PER_SECOND} per second`,
      );
    }
    return intervalMs;
  }

  private static requestTimeoutOf(maxRequestMs: DurationMs): RequestTimeoutMs {
    if (!MockApiPredicates.isRequestTimeoutMs(maxRequestMs)) {
      throw new Error(`DISPATCH_MAX_REQUEST_MS(${maxRequestMs}) is not a valid request timeout`);
    }
    return maxRequestMs;
  }

  private static pageLimitOf(rawPageLimit: number): UserPageLimit {
    if (!MockApiPredicates.isUserPageLimit(rawPageLimit)) {
      throw new Error(`USER_PAGE_LIMIT(${rawPageLimit}) must be between 1 and 1000`);
    }
    return rawPageLimit;
  }
}
