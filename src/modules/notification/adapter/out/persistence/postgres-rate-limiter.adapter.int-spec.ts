import { randomUUID } from 'node:crypto';
import { SQL, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import { RetryAfterMs } from '@/modules/notification/domain/delivery/delivery.type';
import { SendPermit } from '@/modules/notification/application/port/out/send-permit.type';
import { PostgresRateLimiterAdapter } from '@/modules/notification/adapter/out/persistence/postgres-rate-limiter.adapter';
import {
  DatabaseClock,
  RateLimiterSettings,
} from '@/modules/notification/adapter/out/persistence/postgres-rate-limiter.type';
import { NotificationDatabaseFactory } from '@/modules/notification/adapter/out/persistence/notification-database.factory';
import { NotificationDatabase } from '@/modules/notification/adapter/out/persistence/notification-database.type';
import { DurationPredicates } from '@/shared/domain/duration.predicate';
import { DurationMs } from '@/shared/domain/duration.type';
import { TestDatabase } from '@/shared/database/testing/test-database';

type PermitKind = SendPermit['kind'];

interface TimedPermit {
  readonly atMs: number;
  readonly kind: PermitKind;
}

const T0_MS: number = Date.parse('2026-10-08T09:00:00.000Z');
const PERMITS_PER_SECOND: number = 50;
const WINDOW_MS: number = 1_000;

const SWEEP_TIMEOUT_MS: number = 30_000;

class FixedDatabaseClock implements DatabaseClock {
  constructor(private readonly instant: Date) {}

  now(): SQL {
    return sql`${this.instant.toISOString()}::timestamptz`;
  }
}

const retryAfterMs = (value: number): RetryAfterMs => {
  if (!DeliveryPredicates.isRetryAfterMs(value)) {
    throw new Error(`test fixture ${value} is not a valid RetryAfterMs`);
  }
  return value;
};

const durationMs = (value: number): DurationMs => {
  if (!DurationPredicates.isDurationMs(value)) {
    throw new Error(`test fixture duration ${value} is invalid`);
  }
  return value;
};

const maxPermitsInAnyWindow = (grantedAtMs: ReadonlyArray<number>): number =>
  Math.max(
    0,
    ...grantedAtMs.map(
      (windowStartMs: number): number =>
        grantedAtMs.filter(
          (grantedMs: number): boolean =>
            grantedMs >= windowStartMs && grantedMs < windowStartMs + WINDOW_MS,
        ).length,
    ),
  );

const newSettings = (): RateLimiterSettings => ({
  name: `limiter-${randomUUID()}`,
  emissionIntervalMs: durationMs(WINDOW_MS / PERMITS_PER_SECOND),
});

describe('PostgresRateLimiterAdapter', () => {
  let testDatabase: TestDatabase;
  let database: NotificationDatabase;

  const limiterAt = (
    settings: Readonly<RateLimiterSettings>,
    offsetMs: number,
  ): PostgresRateLimiterAdapter =>
    new PostgresRateLimiterAdapter(
      database,
      settings,
      new FixedDatabaseClock(new Date(T0_MS + offsetMs)),
    );

  const acquireAt = async (
    settings: Readonly<RateLimiterSettings>,
    offsetMs: number,
  ): Promise<PermitKind> => (await limiterAt(settings, offsetMs).acquire()).kind;

  beforeAll(async (): Promise<void> => {
    testDatabase = await TestDatabase.create();
    database = NotificationDatabaseFactory.create(testDatabase.pool);
  });

  afterAll(async (): Promise<void> => {
    await testDatabase.drop();
  });

  it('DB-11 처음 쓰는 제한기는 바로 허가하고, 발급 간격(20ms)이 지나기 전에는 거부한다', async (): Promise<void> => {
    const settings: RateLimiterSettings = newSettings();

    expect(await acquireAt(settings, 0)).toBe('granted');
    expect(await acquireAt(settings, 0)).toBe('denied');
    expect(await acquireAt(settings, 19)).toBe('denied');
    expect(await acquireAt(settings, 20)).toBe('granted');
    expect(await acquireAt(settings, 39)).toBe('denied');
  });

  it(
    'DB-11 초당 50건 제한기 (초기 상태 포함) / 워커 여러 개가 경계 시각 전후로 토큰을 요청한다 → 임의의 1초 구간에서 발급된 토큰 합이 50을 넘지 않는다',
    async (): Promise<void> => {
      const settings: RateLimiterSettings = newSettings();
      const workerCount: number = 3;
      const tickMs: number = 5;
      const durationOfRunMs: number = 3 * WINDOW_MS;
      const permits: Array<TimedPermit> = [];

      for (let offsetMs: number = 0; offsetMs < durationOfRunMs; offsetMs += tickMs) {
        const kinds: ReadonlyArray<PermitKind> = await Promise.all(
          Array.from({ length: workerCount }, (): Promise<PermitKind> =>
            acquireAt(settings, offsetMs),
          ),
        );
        permits.push(...kinds.map((kind: PermitKind): TimedPermit => ({ atMs: offsetMs, kind })));
      }
      const grantedAtMs: ReadonlyArray<number> = permits
        .filter(({ kind }: TimedPermit): boolean => kind === 'granted')
        .map(({ atMs }: TimedPermit): number => atMs);

      expect(maxPermitsInAnyWindow(grantedAtMs)).toBe(PERMITS_PER_SECOND);
      expect(grantedAtMs).toHaveLength((durationOfRunMs / WINDOW_MS) * PERMITS_PER_SECOND);
    },
    SWEEP_TIMEOUT_MS,
  );

  it('DB-11 같은 시각에 여러 워커가 동시에 요청하면 하나만 허가한다', async (): Promise<void> => {
    const settings: RateLimiterSettings = newSettings();

    const kinds: ReadonlyArray<PermitKind> = await Promise.all(
      Array.from({ length: 20 }, (): Promise<PermitKind> => acquireAt(settings, 0)),
    );

    expect(kinds.filter((kind: PermitKind): boolean => kind === 'granted')).toHaveLength(1);
  });

  it('DB-11 운영 시계(DB clock_timestamp)로도 처음 요청은 허가하고 곧바로 이어진 요청은 거부한다', async (): Promise<void> => {
    const limiter: PostgresRateLimiterAdapter = new PostgresRateLimiterAdapter(
      database,
      { name: `limiter-${randomUUID()}`, emissionIntervalMs: durationMs(60_000) },
      PostgresRateLimiterAdapter.SERVER_CLOCK,
    );

    expect((await limiter.acquire()).kind).toBe('granted');
    expect((await limiter.acquire()).kind).toBe('denied');
  });

  it('DB-12 제한기가 Retry-After로 정지됐다 / 정지 시각 전에 토큰을 요청한다 → 0개를 받는다', async (): Promise<void> => {
    const settings: RateLimiterSettings = newSettings();
    await limiterAt(settings, 0).holdFor(retryAfterMs(5_000));

    expect(await acquireAt(settings, 0)).toBe('denied');
    expect(await acquireAt(settings, 4_999)).toBe('denied');
    expect(await acquireAt(settings, 5_000)).toBe('granted');
  });

  it('DB-12 허가를 받아 쓰던 제한기도 정지되면 정지 시각까지 거부한다', async (): Promise<void> => {
    const settings: RateLimiterSettings = newSettings();
    expect(await acquireAt(settings, 0)).toBe('granted');

    await limiterAt(settings, 100).holdFor(retryAfterMs(2_000));

    expect(await acquireAt(settings, 100)).toBe('denied');
    expect(await acquireAt(settings, 2_099)).toBe('denied');
    expect(await acquireAt(settings, 2_100)).toBe('granted');
  });

  it('DB-13 정지 중인 제한기 / 더 짧은 Retry-After가 들어온다 → 정지 시각이 앞당겨지지 않는다', async (): Promise<void> => {
    const settings: RateLimiterSettings = newSettings();
    await limiterAt(settings, 0).holdFor(retryAfterMs(5_000));

    await limiterAt(settings, 1_000).holdFor(retryAfterMs(1_000));

    expect(await acquireAt(settings, 2_000)).toBe('denied');
    expect(await acquireAt(settings, 4_999)).toBe('denied');
    expect(await acquireAt(settings, 5_000)).toBe('granted');
  });

  it('DB-13 정지 중인 제한기 / Retry-After: 0이 들어온다 → 정지 시각이 앞당겨지지 않는다', async (): Promise<void> => {
    const settings: RateLimiterSettings = newSettings();
    await limiterAt(settings, 0).holdFor(retryAfterMs(5_000));

    await limiterAt(settings, 1_000).holdFor(retryAfterMs(0));

    expect(await acquireAt(settings, 4_999)).toBe('denied');
    expect(await acquireAt(settings, 5_000)).toBe('granted');
  });

  it('DB-13 더 긴 Retry-After가 들어오면 정지 시각을 늦춘다', async (): Promise<void> => {
    const settings: RateLimiterSettings = newSettings();
    await limiterAt(settings, 0).holdFor(retryAfterMs(1_000));

    await limiterAt(settings, 500).holdFor(retryAfterMs(3_000));

    expect(await acquireAt(settings, 3_499)).toBe('denied');
    expect(await acquireAt(settings, 3_500)).toBe('granted');
  });

  it('DB-12 상한(1시간)인 Retry-After도 그대로 정지 시각에 반영한다', async (): Promise<void> => {
    const settings: RateLimiterSettings = newSettings();
    const oneHourMs: number = 3_600_000;

    await limiterAt(settings, 0).holdFor(retryAfterMs(oneHourMs));

    expect(await acquireAt(settings, oneHourMs - 1)).toBe('denied');
    expect(await acquireAt(settings, oneHourMs)).toBe('granted');
  });

  it('DB-11 32비트 정수 범위를 넘는 발급 간격도 SQL 시각 계산에 그대로 반영한다', async (): Promise<void> => {
    const beyondInt32Ms: number = 2_500_000_000;
    const settings: RateLimiterSettings = {
      name: `limiter-${randomUUID()}`,
      emissionIntervalMs: durationMs(beyondInt32Ms),
    };

    expect(await acquireAt(settings, 0)).toBe('granted');
    expect(await acquireAt(settings, beyondInt32Ms - 1)).toBe('denied');
    expect(await acquireAt(settings, beyondInt32Ms)).toBe('granted');
  });

  it('DB-13 여러 워커가 길고 짧은 Retry-After 정지와 허가 요청을 동시에 보내도 가장 늦은 정지 시각이 남는다', async (): Promise<void> => {
    const rounds: ReadonlyArray<RateLimiterSettings> = Array.from(
      { length: 10 },
      (): RateLimiterSettings => newSettings(),
    );

    await Promise.all(
      rounds.map((settings: RateLimiterSettings): Promise<ReadonlyArray<void | PermitKind>> =>
        Promise.all([
          acquireAt(settings, 0),
          limiterAt(settings, 0).holdFor(retryAfterMs(1_000)),
          acquireAt(settings, 0),
          limiterAt(settings, 0).holdFor(retryAfterMs(5_000)),
          limiterAt(settings, 0).holdFor(retryAfterMs(2_000)),
          acquireAt(settings, 0),
        ]),
      ),
    );

    const afterHolds: ReadonlyArray<ReadonlyArray<PermitKind>> = await Promise.all(
      rounds.map(async (settings: RateLimiterSettings): Promise<ReadonlyArray<PermitKind>> => [
        await acquireAt(settings, 4_999),
        await acquireAt(settings, 5_000),
      ]),
    );
    expect(afterHolds).toEqual(rounds.map((): ReadonlyArray<PermitKind> => ['denied', 'granted']));
  });
});
