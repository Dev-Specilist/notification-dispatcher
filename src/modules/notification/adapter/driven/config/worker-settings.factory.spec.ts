import { Test, TestingModule } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import { AttemptLimit } from '@/modules/notification/domain/delivery/delivery.type';
import { RetryPolicy } from '@/modules/notification/domain/delivery/retry-policy';
import { RetryPolicyCreation } from '@/modules/notification/domain/delivery/retry-policy.type';
import {
  DeliverySettingsValues,
  WorkerEnv,
  WorkerSettings,
} from '@/modules/notification/adapter/driven/config/worker-settings.type';
import { WorkerSettingsFactory } from '@/modules/notification/adapter/driven/config/worker-settings.factory';
import { DurationPredicates } from '@/shared/domain/duration.predicate';
import { DurationMs } from '@/shared/domain/duration.type';
import { createEnvSchema } from '@/shared/config/env.schema';
import { Env } from '@/shared/config/env.type';
import { portSchema } from '@/shared/config/primitive.schema';
import { TypedConfigModule } from '@/shared/config/typed-config.module';
import { TypedConfigService } from '@/shared/config/typed-config.service';

type EnvEntry = Readonly<[key: string, rawValue: string]>;

type InvalidEnvCase = Readonly<
  [label: string, overrides: Readonly<Record<string, string>>, reason: RegExp]
>;

const NON_DEFAULT_ENV: Readonly<Record<string, string>> = {
  MOCK_API_URL: 'http://mock:4000',
  DISPATCH_MAX_REQUEST_MS: '3000',
  DISPATCH_LEASE_MS: '20000',
  RECONCILE_DELAY_MS: '40000',
  RETRY_MAX_ATTEMPTS: '3',
  RETRY_BASE_DELAY_MS: '500',
  RETRY_MAX_DELAY_MS: '30000',
  LOOKUP_RETRY_BASE_DELAY_MS: '2000',
  LOOKUP_RETRY_MAX_DELAY_MS: '20000',
  UNCONFIRMED_AFTER_MS: '600000',
  USER_PAGE_LIMIT: '500',
  RATE_LIMIT_INTERVAL_MS: '25',
};

const env = (overrides: Readonly<Record<string, string>>): WorkerEnv => {
  const parsed: Env = createEnvSchema(portSchema.parse(3001)).parse({
    DATABASE_URL: 'postgres://app:secret@localhost:5432/notification',
    ...overrides,
  });
  return parsed;
};

const durationMs = (rawDurationMs: number): DurationMs => {
  if (!DurationPredicates.isDurationMs(rawDurationMs)) {
    throw new Error(`test fixture ${rawDurationMs} is not a valid DurationMs`);
  }
  return rawDurationMs;
};

const attemptLimit = (rawAttemptLimit: number): AttemptLimit => {
  if (!DeliveryPredicates.isAttemptLimit(rawAttemptLimit)) {
    throw new Error(`test fixture ${rawAttemptLimit} is not a valid AttemptLimit`);
  }
  return rawAttemptLimit;
};

const retryPolicy = (maxAttempts: number, baseDelayMs: number, maxDelayMs: number): RetryPolicy => {
  const creation: RetryPolicyCreation = RetryPolicy.create({
    maxAttempts: attemptLimit(maxAttempts),
    baseDelayMs: durationMs(baseDelayMs),
    maxDelayMs: durationMs(maxDelayMs),
  });
  if (creation.kind !== 'created') {
    throw new Error(`test fixture retry policy is invalid: ${creation.error.code}`);
  }
  return creation.policy;
};

const unboundedLookupRetryPolicy = (baseDelayMs: number, maxDelayMs: number): RetryPolicy =>
  retryPolicy(Number.MAX_SAFE_INTEGER, baseDelayMs, maxDelayMs);

describe('WorkerSettingsFactory', () => {
  afterEach((): void => {
    vi.unstubAllEnvs();
  });

  it('검증된 설정 서비스의 env 값을 그대로 옮겨 같은 워커 설정을 만든다', async (): Promise<void> => {
    vi.stubEnv('DATABASE_URL', 'postgres://app:secret@localhost:5432/notification');
    Object.entries(NON_DEFAULT_ENV).forEach(([key, rawValue]: EnvEntry): void => {
      vi.stubEnv(key, rawValue);
    });
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [TypedConfigModule.forRoot(createEnvSchema(portSchema.parse(3001)))],
    }).compile();

    const settings: WorkerSettings = WorkerSettingsFactory.fromConfig(
      moduleRef.get(TypedConfigService),
    );
    await moduleRef.close();

    expect(settings).toEqual(WorkerSettingsFactory.create(env(NON_DEFAULT_ENV)));
  });

  it('env 값을 발송·lease 복구·reconcile 설정과 mock API·제한기 설정으로 바꾼다', (): void => {
    const settings: WorkerSettings = WorkerSettingsFactory.create(env({}));

    expect(settings.deliverySettings).toMatchObject({
      leaseMs: 30_000,
      maxRequestMs: 5_000,
      reconcileDelayMs: 35_000,
      unconfirmedAfterMs: 3_600_000,
    });
    expect(settings.deliverySettings.retryPolicy).toEqual(retryPolicy(5, 1_000, 60_000));
    expect(settings.deliverySettings.lookupRetryPolicy).toEqual(
      unboundedLookupRetryPolicy(5_000, 60_000),
    );
    expect(settings.mockApi).toEqual({
      baseUrl: new URL('http://localhost:4000'),
      requestTimeoutMs: 5_000,
    });
    expect(settings.recipientDirectory).toEqual({
      baseUrl: new URL('http://localhost:4000'),
      requestTimeoutMs: 5_000,
      pageLimit: 1_000,
    });
    expect(settings.rateLimiter).toEqual({ name: 'mock-message-send', emissionIntervalMs: 20 });
  });

  it('기본값과 다른 유효한 env 값을 그대로 설정에 반영한다', (): void => {
    const settings: WorkerSettings = WorkerSettingsFactory.create(env(NON_DEFAULT_ENV));

    expect(settings.deliverySettings).toMatchObject({
      leaseMs: 20_000,
      maxRequestMs: 3_000,
      reconcileDelayMs: 40_000,
      unconfirmedAfterMs: 600_000,
    });
    expect(settings.deliverySettings.retryPolicy).toEqual(retryPolicy(3, 500, 30_000));
    expect(settings.deliverySettings.lookupRetryPolicy).toEqual(
      unboundedLookupRetryPolicy(2_000, 20_000),
    );
    expect(settings.recipientDirectory).toEqual({
      baseUrl: new URL('http://mock:4000'),
      requestTimeoutMs: 3_000,
      pageLimit: 500,
    });
    expect(settings.rateLimiter).toEqual({ name: 'mock-message-send', emissionIntervalMs: 25 });
  });

  it('조회 재시도 정책은 시도 횟수로 소진되지 않고 조회 종료는 UNCONFIRMED_AFTER_MS에 맡긴다', (): void => {
    const { lookupRetryPolicy }: DeliverySettingsValues = WorkerSettingsFactory.create(
      env({}),
    ).deliverySettings;

    expect(lookupRetryPolicy.isExhausted(Number.MAX_SAFE_INTEGER - 1)).toBe(false);
  });

  it('제한기 간격이 정확히 20ms(초당 50건)이면 허용한다', (): void => {
    expect(
      WorkerSettingsFactory.create(env({ RATE_LIMIT_INTERVAL_MS: '20' })).rateLimiter
        .emissionIntervalMs,
    ).toBe(20);
  });

  it.each<InvalidEnvCase>([
    [
      '제한기 간격이 20ms보다 짧아 초당 50건을 넘을 수 있으면',
      { RATE_LIMIT_INTERVAL_MS: '19' },
      /RATE_LIMIT_INTERVAL_MS/,
    ],
    [
      '재시도 base 지연이 max 지연보다 길면',
      { RETRY_BASE_DELAY_MS: '70000', RETRY_MAX_DELAY_MS: '60000' },
      /RETRY_BASE_DELAY_MS/,
    ],
    [
      '조회 재시도 base 지연이 max 지연보다 길면',
      { LOOKUP_RETRY_BASE_DELAY_MS: '70000', LOOKUP_RETRY_MAX_DELAY_MS: '60000' },
      /LOOKUP_RETRY_BASE_DELAY_MS/,
    ],
    [
      'lease가 최대 요청 시간보다 길지 않으면',
      { DISPATCH_LEASE_MS: '5000', DISPATCH_MAX_REQUEST_MS: '5000' },
      /DISPATCH_LEASE_MS/,
    ],
    [
      '사용자 API page limit이 mock 한도 1000을 넘으면',
      { USER_PAGE_LIMIT: '1001' },
      /USER_PAGE_LIMIT/,
    ],
  ])(
    '%s 기동 단계에서 거절한다',
    (_label: string, overrides: Readonly<Record<string, string>>, reason: RegExp): void => {
      expect(() => WorkerSettingsFactory.create(env(overrides))).toThrow(reason);
    },
  );
});
