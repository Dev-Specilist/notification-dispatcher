import { INestApplication, Type } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { request, spec } from 'pactum';
import { Pool, QueryResult } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { WorkerEnvironment, WorkerProcess } from '@/bootstrap/testing/worker.process';
import {
  MockApiContainer,
  MockApiEnvironment,
} from '@/modules/notification/testing/mock-api.container';
import { TestDatabase } from '@/shared/database/testing/test-database';

interface DeliveryRow {
  readonly id: string;
  readonly status: string;
  readonly failureReason: string;
  readonly attempts: number;
}

interface HeldRow {
  readonly held: boolean;
}

interface UrgentDispatch {
  readonly alarmId: string;
  readonly bulkClaimedOrSettledBeforeUrgent: number;
}

interface ClaimedOrSettledCountRow {
  readonly claimedOrSettled: number;
}

interface UnsettledCountRow {
  readonly unsettled: number;
}

interface SentCountRow {
  readonly sent: number;
}

interface DeliveryDelivered {
  readonly status: string;
  readonly failureReason: string;
  readonly mockMessages: number;
  readonly attempts: number;
  readonly mockSentAt: ReadonlyArray<number>;
}

const createdAlarmSchema = z.object({ id: z.string() });

type CreatedAlarm = z.infer<typeof createdAlarmSchema>;

const alarmStatusSchema = z.object({ status: z.string() });

type AlarmStatusView = z.infer<typeof alarmStatusSchema>;

const mockMessagesSchema = z.object({
  messages: z.array(z.object({ messageId: z.string(), sentAt: z.iso.datetime() })),
});

type MockMessages = z.infer<typeof mockMessagesSchema>;

type MockMessage = MockMessages['messages'][number];

const COMPLETION_TIMEOUT_MS: number = 60_000;

const DISPATCH_CONCURRENCY: number = 8;

const URGENT_RECIPIENTS: number = 100;

const dispatchedBulkAlarm = async (): Promise<CreatedAlarm> => {
  const createdAlarm: CreatedAlarm = createdAlarmSchema.parse(
    await spec()
      .post('/alarms')
      .withJson({ title: '추석 이벤트', body: '쿠폰이 도착했습니다', kind: 'BULK' })
      .expectStatus(201)
      .returns('res.body'),
  );
  await spec().post(`/alarms/${createdAlarm.id}/dispatch`).expectStatus(202);
  return createdAlarm;
};

const alarmStatus = async (alarmId: string): Promise<string> => {
  const { status }: AlarmStatusView = alarmStatusSchema.parse(
    await spec().get(`/alarms/${alarmId}`).expectStatus(200).returns('res.body'),
  );
  return status;
};

const mockMessagesOf = async (
  mockApi: MockApiContainer,
  clientRef: string,
): Promise<MockMessages> => {
  const response: Response = await fetch(
    new URL(`/v1/messages?clientRef=${clientRef}`, mockApi.baseUrl),
  );
  return mockMessagesSchema.parse(await response.json());
};

const createUrgentAlarm = async (recipientCount: number): Promise<CreatedAlarm> =>
  createdAlarmSchema.parse(
    await spec()
      .post('/alarms')
      .withJson({
        title: '서버 점검',
        body: '10분 뒤 점검이 시작됩니다',
        kind: 'URGENT',
        recipientIds: Array.from(
          { length: recipientCount },
          (_entry: object, index: number): string => `u_${String(index + 1).padStart(6, '0')}`,
        ),
      })
      .expectStatus(201)
      .returns('res.body'),
  );

const withMockApi = async (
  environment: Readonly<Partial<MockApiEnvironment>>,
  run: (mockApi: MockApiContainer) => Promise<void>,
): Promise<void> => {
  const mockApi: MockApiContainer = await MockApiContainer.start(environment);
  try {
    await run(mockApi);
  } finally {
    await mockApi.stop();
  }
};

describe('발송 전체 흐름', () => {
  let testDatabase: TestDatabase;
  let api: INestApplication;
  let buildDir: string;

  beforeAll(async (): Promise<void> => {
    buildDir = WorkerProcess.build();
    testDatabase = await TestDatabase.create();
    vi.stubEnv('DATABASE_URL', testDatabase.databaseUrl);
    const rootModule: Type = (await import('@/bootstrap/api.module.js')).ApiModule;
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [rootModule],
    }).compile();
    api = moduleRef.createNestApplication();
    await api.listen(0, '127.0.0.1');
    request.setBaseUrl(await api.getUrl());
  });

  afterAll(async (): Promise<void> => {
    await api.close();
    vi.unstubAllEnvs();
    await testDatabase.drop();
    await WorkerProcess.removeBuild(buildDir);
  });

  const deliveriesOf = async (
    alarmId: string,
    mockApi: MockApiContainer,
  ): Promise<ReadonlyArray<DeliveryDelivered>> => {
    const result: QueryResult<DeliveryRow> = await api
      .get(Pool)
      .query<DeliveryRow>(
        `SELECT id, status, coalesce(failure_reason, 'none') AS "failureReason", attempts FROM deliveries WHERE alarm_id = $1`,
        [alarmId],
      );
    return Promise.all(
      result.rows.map(
        async ({
          id,
          status,
          failureReason,
          attempts,
        }: DeliveryRow): Promise<DeliveryDelivered> => {
          const { messages }: MockMessages = await mockMessagesOf(mockApi, id);
          return {
            status,
            failureReason,
            attempts,
            mockMessages: messages.length,
            mockSentAt: messages.map(({ sentAt }: MockMessage): number => Date.parse(sentAt)),
          };
        },
      ),
    );
  };

  const sentDeliveryCount = async (alarmId: string): Promise<number> => {
    const result: QueryResult<SentCountRow> = await api
      .get(Pool)
      .query<SentCountRow>(
        "SELECT count(*)::int AS sent FROM deliveries WHERE alarm_id = $1 AND status = 'SENT'",
        [alarmId],
      );
    const [{ sent }]: ReadonlyArray<SentCountRow> = result.rows;
    return sent;
  };

  const claimedOrSettledDeliveryCount = async (alarmId: string): Promise<number> => {
    const result: QueryResult<ClaimedOrSettledCountRow> = await api
      .get(Pool)
      .query<ClaimedOrSettledCountRow>(
        "SELECT count(*)::int AS \"claimedOrSettled\" FROM deliveries WHERE alarm_id = $1 AND status NOT IN ('PENDING', 'CANCELLED')",
        [alarmId],
      );
    const [{ claimedOrSettled }]: ReadonlyArray<ClaimedOrSettledCountRow> = result.rows;
    return claimedOrSettled;
  };

  const unsettledDeliveryCount = async (alarmId: string): Promise<number> => {
    const result: QueryResult<UnsettledCountRow> = await api
      .get(Pool)
      .query<UnsettledCountRow>(
        "SELECT count(*)::int AS unsettled FROM deliveries WHERE alarm_id = $1 AND status NOT IN ('SENT', 'FAILED', 'CANCELLED', 'UNCONFIRMED')",
        [alarmId],
      );
    const [{ unsettled }]: ReadonlyArray<UnsettledCountRow> = result.rows;
    return unsettled;
  };

  const resetRateLimiter = async (): Promise<void> => {
    await api.get(Pool).query('DELETE FROM rate_limiters');
  };

  const rateLimiterWasHeld = async (): Promise<boolean> => {
    const result: QueryResult<HeldRow> = await api
      .get(Pool)
      .query<HeldRow>(
        "SELECT bool_or(held_until <> '-infinity'::timestamptz) AS held FROM rate_limiters",
      );
    const [{ held }]: ReadonlyArray<HeldRow> = result.rows;
    return held;
  };

  const runWorkers = async <TResult>(
    workerCount: number,
    mockApi: MockApiContainer,
    run: (workers: ReadonlyArray<WorkerProcess>) => Promise<TResult>,
    workerEnvironment: WorkerEnvironment = {},
  ): Promise<TResult> => {
    const workers: Array<WorkerProcess> = [];
    try {
      for (let index: number = 0; index < workerCount; index += 1) {
        workers.push(
          await WorkerProcess.start(buildDir, {
            DATABASE_URL: testDatabase.databaseUrl,
            MOCK_API_URL: mockApi.baseUrl.toString(),
            SHUTDOWN_DRAIN_MS: '0',
            ...workerEnvironment,
          }),
        );
      }
      return await run(workers);
    } finally {
      await Promise.all(workers.map((worker: WorkerProcess): Promise<void> => worker.kill()));
    }
  };

  it('E2E-01 USER_COUNT를 줄이고 일시 오류·타임아웃을 끈 mock, 워커 1개 / 대량 알림을 만들고 발송을 시작한다 → 수신 거부가 아닌 사용자는 mock 발송 내역 기준 정확히 1회, 수신 거부 사용자는 0회 발송되어 FAILED가 되고, 알림이 COMPLETED가 된다', async (): Promise<void> => {
    await withMockApi(
      { USER_COUNT: '200', BLOCKED_PERCENT: '5', RATE_LIMIT: '50' },
      async (mockApi: MockApiContainer): Promise<void> => {
        const { id: alarmId }: CreatedAlarm = await dispatchedBulkAlarm();

        await runWorkers(1, mockApi, async (): Promise<void> => {
          await vi.waitFor(
            async (): Promise<void> => {
              expect(await alarmStatus(alarmId)).toBe('COMPLETED');
            },
            { timeout: COMPLETION_TIMEOUT_MS, interval: 500 },
          );
        });

        const deliveries: ReadonlyArray<DeliveryDelivered> = await deliveriesOf(alarmId, mockApi);
        const blocked: ReadonlyArray<DeliveryDelivered> = deliveries.filter(
          ({ status }: DeliveryDelivered): boolean => status === 'FAILED',
        );
        expect(deliveries).toHaveLength(200);
        expect(blocked.length).toBeGreaterThan(0);
        expect(
          deliveries.filter(
            ({ status, mockMessages }: DeliveryDelivered): boolean =>
              !(status === 'SENT' && mockMessages === 1) &&
              !(status === 'FAILED' && mockMessages === 0),
          ),
        ).toEqual([]);
        expect(
          blocked.every(
            ({ failureReason }: DeliveryDelivered): boolean =>
              failureReason === 'RECIPIENT_BLOCKED',
          ),
        ).toBe(true);
      },
    );
  }, 120_000);

  it('E2E-02 오류·타임아웃 비율을 높인 mock / 대량 알림 발송 → 일시 오류는 재시도되고, 타임아웃 건은 reconcile로 확정되어 같은 clientRef 내역이 2건 이상인 Delivery가 없다', async (): Promise<void> => {
    await withMockApi(
      {
        USER_COUNT: '100',
        RATE_LIMIT: '50',
        ERROR_RATE: '0.2',
        TIMEOUT_RATE: '0.1',
        TIMEOUT_MS: '3000',
      },
      async (mockApi: MockApiContainer): Promise<void> => {
        const { id: alarmId }: CreatedAlarm = await dispatchedBulkAlarm();

        await runWorkers(
          1,
          mockApi,
          async (): Promise<void> => {
            await vi.waitFor(
              async (): Promise<void> => {
                expect(await alarmStatus(alarmId)).toBe('COMPLETED');
              },
              { timeout: COMPLETION_TIMEOUT_MS, interval: 500 },
            );
          },
          {
            DISPATCH_MAX_REQUEST_MS: '1000',
            DISPATCH_LEASE_MS: '3000',
            RECONCILE_DELAY_MS: '4000',
            RETRY_MAX_ATTEMPTS: '10',
            RETRY_BASE_DELAY_MS: '200',
            RETRY_MAX_DELAY_MS: '1000',
            LOOKUP_RETRY_BASE_DELAY_MS: '500',
            LOOKUP_RETRY_MAX_DELAY_MS: '2000',
          },
        );

        const deliveries: ReadonlyArray<DeliveryDelivered> = await deliveriesOf(alarmId, mockApi);
        expect(deliveries).toHaveLength(100);
        expect(
          deliveries.filter(({ mockMessages }: DeliveryDelivered): boolean => mockMessages >= 2),
        ).toEqual([]);
        expect(
          deliveries.filter(
            ({ status, mockMessages }: DeliveryDelivered): boolean =>
              status !== 'SENT' || mockMessages !== 1,
          ),
        ).toEqual([]);
        expect(
          deliveries.filter(({ attempts }: DeliveryDelivered): boolean => attempts > 1).length,
        ).toBeGreaterThan(0);
      },
    );
  }, 120_000);
  it('E2E-03 대량 알림 발송 중 / 긴급 알림이 발송 가능해진다 → 발송 가능한 긴급 Delivery가 남아 있는 동안 발송 허가를 얻은 요청은 모두 긴급 Delivery를 보낸다 (이미 시작된 대량 요청은 제외)', async (): Promise<void> => {
    await withMockApi(
      { USER_COUNT: '300', RATE_LIMIT: '50' },
      async (mockApi: MockApiContainer): Promise<void> => {
        const { id: bulkAlarmId }: CreatedAlarm = await dispatchedBulkAlarm();
        await resetRateLimiter();
        const { alarmId: urgentAlarmId, bulkClaimedOrSettledBeforeUrgent }: UrgentDispatch =
          await runWorkers(
            1,
            mockApi,
            async (): Promise<UrgentDispatch> => {
              await vi.waitFor(
                async (): Promise<void> => {
                  expect(await sentDeliveryCount(bulkAlarmId)).toBeGreaterThanOrEqual(50);
                },
                { timeout: COMPLETION_TIMEOUT_MS, interval: 100 },
              );
              const { id: alarmId }: CreatedAlarm = await createUrgentAlarm(URGENT_RECIPIENTS);
              await spec().post(`/alarms/${alarmId}/dispatch`).expectStatus(202);
              const claimedOrSettledBulk: number = await claimedOrSettledDeliveryCount(bulkAlarmId);
              await vi.waitFor(
                async (): Promise<void> => {
                  expect(await alarmStatus(alarmId)).toBe('COMPLETED');
                  expect(await alarmStatus(bulkAlarmId)).toBe('COMPLETED');
                },
                { timeout: COMPLETION_TIMEOUT_MS, interval: 500 },
              );
              return { alarmId, bulkClaimedOrSettledBeforeUrgent: claimedOrSettledBulk };
            },
            { DISPATCH_CONCURRENCY: String(DISPATCH_CONCURRENCY) },
          );

        const urgentSentAt: ReadonlyArray<number> = (
          await deliveriesOf(urgentAlarmId, mockApi)
        ).flatMap(({ mockSentAt }: DeliveryDelivered): ReadonlyArray<number> => mockSentAt);
        const lastUrgentSentAt: number = Math.max(...urgentSentAt);
        const bulkSentBeforeLastUrgent: ReadonlyArray<number> = (
          await deliveriesOf(bulkAlarmId, mockApi)
        )
          .flatMap(({ mockSentAt }: DeliveryDelivered): ReadonlyArray<number> => mockSentAt)
          .filter((sentAt: number): boolean => sentAt < lastUrgentSentAt);
        expect(urgentSentAt).toHaveLength(URGENT_RECIPIENTS);
        expect(bulkSentBeforeLastUrgent.length).toBeLessThanOrEqual(
          bulkClaimedOrSettledBeforeUrgent + DISPATCH_CONCURRENCY,
        );
      },
    );
  }, 120_000);

  it.each([2, 3])(
    'E2E-04 워커 여러 개(%i개) / 대량 알림 발송 → 429 없이 중복·누락 없이 끝난다',
    async (workerCount: number): Promise<void> => {
      await withMockApi(
        { USER_COUNT: '300', RATE_LIMIT: '50' },
        async (mockApi: MockApiContainer): Promise<void> => {
          await resetRateLimiter();
          const { id: alarmId }: CreatedAlarm = await dispatchedBulkAlarm();

          await runWorkers(workerCount, mockApi, async (): Promise<void> => {
            await vi.waitFor(
              async (): Promise<void> => {
                expect(await alarmStatus(alarmId)).toBe('COMPLETED');
              },
              { timeout: COMPLETION_TIMEOUT_MS, interval: 500 },
            );
          });

          const deliveries: ReadonlyArray<DeliveryDelivered> = await deliveriesOf(alarmId, mockApi);
          expect(deliveries).toHaveLength(300);
          expect(
            deliveries.filter(
              ({ status, mockMessages }: DeliveryDelivered): boolean =>
                status !== 'SENT' || mockMessages !== 1,
            ),
          ).toEqual([]);
          expect(await rateLimiterWasHeld()).toBe(false);
        },
      );
    },
    120_000,
  );
  it.each([2, 3])(
    'E2E-05 워커 여러 개(%i개)로 발송 중 / 워커 하나를 강제로 멈춘다 → 남은 워커가 lease 만료분까지 이어받아 중복·누락 없이 끝난다',
    async (workerCount: number): Promise<void> => {
      await withMockApi(
        { USER_COUNT: '200', RATE_LIMIT: '50', SLOW_RATE: '1', SLOW_MS: '500' },
        async (mockApi: MockApiContainer): Promise<void> => {
          await resetRateLimiter();
          const { id: alarmId }: CreatedAlarm = await dispatchedBulkAlarm();

          await runWorkers(
            workerCount,
            mockApi,
            async ([killedWorker]: ReadonlyArray<WorkerProcess>): Promise<void> => {
              await vi.waitFor(
                async (): Promise<void> => {
                  expect(await sentDeliveryCount(alarmId)).toBeGreaterThanOrEqual(40);
                },
                { timeout: COMPLETION_TIMEOUT_MS, interval: 50 },
              );
              await killedWorker.kill();
              await vi.waitFor(
                async (): Promise<void> => {
                  expect(await alarmStatus(alarmId)).toBe('COMPLETED');
                },
                { timeout: COMPLETION_TIMEOUT_MS, interval: 500 },
              );
            },
            {
              DISPATCH_MAX_REQUEST_MS: '1000',
              DISPATCH_LEASE_MS: '3000',
              RECONCILE_DELAY_MS: '4000',
            },
          );

          const deliveries: ReadonlyArray<DeliveryDelivered> = await deliveriesOf(alarmId, mockApi);
          expect(deliveries).toHaveLength(200);
          expect(
            deliveries.filter(
              ({ status, mockMessages }: DeliveryDelivered): boolean =>
                status !== 'SENT' || mockMessages !== 1,
            ),
          ).toEqual([]);
        },
      );
    },
    120_000,
  );
  it('E2E-06 대량 알림 발송 중 / 알림을 취소한다 → 새 발송이 멈추고, 이미 나간 건은 SENT로 남으며 나머지는 CANCELLED가 된다', async (): Promise<void> => {
    await withMockApi(
      { USER_COUNT: '300', RATE_LIMIT: '50' },
      async (mockApi: MockApiContainer): Promise<void> => {
        await resetRateLimiter();
        const { id: alarmId }: CreatedAlarm = await dispatchedBulkAlarm();

        const claimedOrSettledAtCancel: number = await runWorkers(
          1,
          mockApi,
          async (): Promise<number> => {
            await vi.waitFor(
              async (): Promise<void> => {
                expect(await sentDeliveryCount(alarmId)).toBeGreaterThanOrEqual(50);
              },
              { timeout: COMPLETION_TIMEOUT_MS, interval: 50 },
            );
            await spec().post(`/alarms/${alarmId}/cancel`).expectStatus(200);
            const claimedOrSettled: number = await claimedOrSettledDeliveryCount(alarmId);
            expect(claimedOrSettled).toBeLessThan(300);
            await vi.waitFor(
              async (): Promise<void> => {
                expect(await unsettledDeliveryCount(alarmId)).toBe(0);
              },
              { timeout: COMPLETION_TIMEOUT_MS, interval: 200 },
            );
            return claimedOrSettled;
          },
        );

        const deliveries: ReadonlyArray<DeliveryDelivered> = await deliveriesOf(alarmId, mockApi);
        const sent: ReadonlyArray<DeliveryDelivered> = deliveries.filter(
          ({ status }: DeliveryDelivered): boolean => status === 'SENT',
        );
        const cancelled: ReadonlyArray<DeliveryDelivered> = deliveries.filter(
          ({ status }: DeliveryDelivered): boolean => status === 'CANCELLED',
        );
        expect(await alarmStatus(alarmId)).toBe('CANCELLED');
        expect(deliveries).toHaveLength(300);
        expect(
          deliveries.filter(
            ({ status, mockMessages }: DeliveryDelivered): boolean =>
              !(status === 'SENT' && mockMessages === 1) &&
              !(status === 'CANCELLED' && mockMessages === 0),
          ),
        ).toEqual([]);
        expect(sent.length).toBeGreaterThanOrEqual(50);
        expect(sent.length).toBeLessThanOrEqual(claimedOrSettledAtCancel);
        expect(cancelled.length).toBeGreaterThan(0);
      },
    );
  }, 120_000);
});
