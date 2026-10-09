import { randomUUID } from 'node:crypto';
import { scheduler } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import { DeliveryId } from '@/modules/notification/domain/delivery/delivery.type';
import { MessageLookupResult } from '@/modules/notification/application/port/driven/for-looking-up-messages/message-lookup.type';
import {
  OutgoingMessage,
  SendOutcome,
  SendOutcomeKind,
} from '@/modules/notification/application/port/driven/for-sending-messages/message-sender.type';
import { SendPermit } from '@/modules/notification/application/port/driven/for-permitting-sends/send-permit.type';
import { MockApiPredicates } from '@/modules/notification/adapter/driven/mock-api/mock-api.predicate';
import { RequestTimeoutMs } from '@/modules/notification/adapter/driven/mock-api/mock-api.type';
import { MockMessageLookupAdapter } from '@/modules/notification/adapter/driven/mock-api/message/mock-message-lookup.adapter';
import { MockMessageSenderAdapter } from '@/modules/notification/adapter/driven/mock-api/message/mock-message-sender.adapter';
import { PostgresRateLimiterAdapter } from '@/modules/notification/adapter/driven/persistence/rate-limiter/postgres-rate-limiter.adapter';
import { NotificationDatabaseFactory } from '@/modules/notification/adapter/driven/persistence/notification-database.factory';
import { MockApiContainer } from '@/modules/notification/testing/mock-api.container';
import { DurationPredicates } from '@/shared/domain/duration.predicate';
import { DurationMs } from '@/shared/domain/duration.type';
import { TestDatabase } from '@/shared/database/testing/test-database';

const PERMITS_PER_SECOND: number = 50;

const RUN_MS: number = 2_000;

const WORKER_COUNT: number = 20;

const DENIED_BACKOFF_MS: number = 5;

const REQUEST_TIMEOUT_MS: number = 5_000;

const NO_SHUTDOWN_ABORT: AbortSignal = new AbortController().signal;

const MINIMUM_THROUGHPUT_RATIO: number = 0.8;

const BUCKET_REFILL_MS: number = 1_000;

const SEND_TIMEOUT_MS: number = 2_000;

const LOOKUP_DELAY_MS: number = 300;

const LOOKUP_TIMEOUT_MS: number = 1_000;

const requestTimeoutMs = (value: number): RequestTimeoutMs => {
  if (!MockApiPredicates.isRequestTimeoutMs(value)) {
    throw new Error(`test fixture ${value} is not a valid RequestTimeoutMs`);
  }
  return value;
};

const durationMs = (value: number): DurationMs => {
  if (!DurationPredicates.isDurationMs(value)) {
    throw new Error(`test fixture ${value} is not a valid DurationMs`);
  }
  return value;
};

const newClientRef = (): DeliveryId => {
  const rawDeliveryId: string = randomUUID();
  if (!DeliveryPredicates.isDeliveryId(rawDeliveryId)) {
    throw new Error(`generated ${rawDeliveryId} is not a valid DeliveryId`);
  }
  return rawDeliveryId;
};

const messageWith = (clientRef: DeliveryId): OutgoingMessage => {
  const alarmId: string = randomUUID();
  const recipientId: string = 'u_000001';
  if (!AlarmPredicates.isAlarmId(alarmId) || !AlarmPredicates.isRecipientId(recipientId)) {
    throw new Error('test fixture message is invalid');
  }
  return { alarmId, recipientId, body: '추석 이벤트 안내', clientRef };
};

const countOf = (outcomes: ReadonlyArray<SendOutcome>, expected: SendOutcomeKind): number =>
  outcomes.filter(({ kind }: SendOutcome): boolean => kind === expected).length;

describe('MockMessageSenderAdapter', () => {
  let testDatabase: TestDatabase;
  let defaultRateMock: MockApiContainer;
  let stallingMock: MockApiContainer;

  beforeAll(async (): Promise<void> => {
    [testDatabase, defaultRateMock, stallingMock] = await Promise.all([
      TestDatabase.create(),
      MockApiContainer.start({ RATE_LIMIT: String(PERMITS_PER_SECOND) }),
      MockApiContainer.start({ TIMEOUT_RATE: '1', TIMEOUT_MS: '5000' }),
    ]);
  });

  afterAll(async (): Promise<void> => {
    await Promise.all([testDatabase.drop(), defaultRateMock.stop(), stallingMock.stop()]);
  });

  it('EXT-10 기본 RATE_LIMIT mock / 제한기를 거쳐 2초 동안 연속 발송한다 → 429가 나오지 않는다 (mock 한도 구간 방식에 대한 특성 테스트)', async (): Promise<void> => {
    const limiterNamed = (name: string): PostgresRateLimiterAdapter =>
      new PostgresRateLimiterAdapter(
        NotificationDatabaseFactory.create(testDatabase.pool),
        { name, emissionIntervalMs: durationMs(1_000 / PERMITS_PER_SECOND) },
        PostgresRateLimiterAdapter.SERVER_CLOCK,
      );
    const sender: MockMessageSenderAdapter = new MockMessageSenderAdapter(
      {
        baseUrl: defaultRateMock.baseUrl,
        requestTimeoutMs: requestTimeoutMs(REQUEST_TIMEOUT_MS),
      },
      NO_SHUTDOWN_ABORT,
    );
    const warmUpLimiter: PostgresRateLimiterAdapter = limiterNamed(`warm-up-${randomUUID()}`);
    await Promise.all(
      Array.from({ length: WORKER_COUNT }, async (): Promise<void> => {
        await warmUpLimiter.acquire();
        await sender.send(messageWith(newClientRef()));
      }),
    );
    await scheduler.wait(BUCKET_REFILL_MS);
    const limiter: PostgresRateLimiterAdapter = limiterNamed(`characterization-${randomUUID()}`);
    const deadline: number = performance.now() + RUN_MS;
    const runWorker = async (
      sent: ReadonlyArray<SendOutcome>,
    ): Promise<ReadonlyArray<SendOutcome>> => {
      if (performance.now() >= deadline) {
        return sent;
      }
      const permit: SendPermit = await limiter.acquire();
      if (permit.kind === 'denied') {
        await scheduler.wait(DENIED_BACKOFF_MS);
        return runWorker(sent);
      }
      return runWorker([...sent, await sender.send(messageWith(newClientRef()))]);
    };

    const outcomes: ReadonlyArray<SendOutcome> = (
      await Promise.all(
        Array.from({ length: WORKER_COUNT }, (): Promise<ReadonlyArray<SendOutcome>> =>
          runWorker([]),
        ),
      )
    ).flat();

    expect(countOf(outcomes, 'rate-limited')).toBe(0);
    expect(countOf(outcomes, 'accepted')).toBeGreaterThanOrEqual(
      (RUN_MS / 1_000) * PERMITS_PER_SECOND * MINIMUM_THROUGHPUT_RATIO,
    );
  });

  it('EXT-11 TIMEOUT_RATE=1 mock / 발송 요청 직후 응답을 기다리는 동안 발송 내역을 조회한다 → 내역이 이미 있다 (발송 기록 시점에 대한 특성 테스트, reconcile 가정의 근거)', async (): Promise<void> => {
    const clientRef: DeliveryId = newClientRef();
    const sender: MockMessageSenderAdapter = new MockMessageSenderAdapter(
      {
        baseUrl: stallingMock.baseUrl,
        requestTimeoutMs: requestTimeoutMs(SEND_TIMEOUT_MS),
      },
      NO_SHUTDOWN_ABORT,
    );
    const lookup: MockMessageLookupAdapter = new MockMessageLookupAdapter(
      {
        baseUrl: stallingMock.baseUrl,
        requestTimeoutMs: requestTimeoutMs(LOOKUP_TIMEOUT_MS),
      },
      NO_SHUTDOWN_ABORT,
    );
    let sendSettled: boolean = false;

    const pendingSend: Promise<SendOutcome> = sender
      .send(messageWith(clientRef))
      .then((settled: SendOutcome): SendOutcome => {
        sendSettled = true;
        return settled;
      });
    await scheduler.wait(LOOKUP_DELAY_MS);
    const duringPendingResponse: MessageLookupResult = await lookup.findByClientRef(clientRef);
    const sendSettledBeforeLookupFinished: boolean = sendSettled;
    const outcome: SendOutcome = await pendingSend;

    expect(sendSettledBeforeLookupFinished).toBe(false);
    expect(duringPendingResponse.kind).toBe('found');
    expect(outcome).toEqual({ kind: 'indeterminate' });
  });
});
