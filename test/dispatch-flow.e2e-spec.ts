import { INestApplication, Type } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { request, spec } from 'pactum';
import { Pool, QueryResult } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { WorkerProcess } from '@/bootstrap/testing/worker.process';
import {
  MockApiContainer,
  MockApiEnvironment,
} from '@/modules/notification/testing/mock-api.container';
import { TestDatabase } from '@/shared/database/testing/test-database';

interface DeliveryRow {
  readonly id: string;
  readonly status: string;
  readonly failure_reason: string;
}

interface DeliveryDelivered {
  readonly status: string;
  readonly failureReason: string;
  readonly mockMessages: number;
}

const createdAlarmSchema = z.object({ id: z.string() });

type CreatedAlarm = z.infer<typeof createdAlarmSchema>;

const alarmStatusSchema = z.object({ status: z.string() });

type AlarmStatusView = z.infer<typeof alarmStatusSchema>;

const mockMessagesSchema = z.object({ messages: z.array(z.object({ messageId: z.string() })) });

type MockMessages = z.infer<typeof mockMessagesSchema>;

const COMPLETION_TIMEOUT_MS: number = 60_000;

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

const mockMessageCount = async (mockApi: MockApiContainer, clientRef: string): Promise<number> => {
  const response: Response = await fetch(
    new URL(`/v1/messages?clientRef=${clientRef}`, mockApi.baseUrl),
  );
  const { messages }: MockMessages = mockMessagesSchema.parse(await response.json());
  return messages.length;
};

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
        "SELECT id, status, coalesce(failure_reason, 'none') AS failure_reason FROM deliveries WHERE alarm_id = $1",
        [alarmId],
      );
    return Promise.all(
      result.rows.map(
        async ({ id, status, failure_reason }: DeliveryRow): Promise<DeliveryDelivered> => ({
          status,
          failureReason: failure_reason,
          mockMessages: await mockMessageCount(mockApi, id),
        }),
      ),
    );
  };

  const runWorkers = async (
    workerCount: number,
    mockApi: MockApiContainer,
    run: () => Promise<void>,
  ): Promise<void> => {
    const workers: Array<WorkerProcess> = [];
    try {
      for (let index: number = 0; index < workerCount; index += 1) {
        workers.push(
          await WorkerProcess.start(buildDir, {
            DATABASE_URL: testDatabase.databaseUrl,
            MOCK_API_URL: mockApi.baseUrl.toString(),
            SHUTDOWN_DRAIN_MS: '0',
          }),
        );
      }
      await run();
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

  it.todo(
    'E2E-02 오류·타임아웃 비율을 높인 mock / 대량 알림 발송 → 일시 오류는 재시도되고, 타임아웃 건은 reconcile로 확정되어 같은 clientRef 내역이 2건 이상인 Delivery가 없다',
  );
  it.todo(
    'E2E-03 대량 알림 발송 중 / 긴급 알림이 발송 가능해진다 → 발송 가능한 긴급 Delivery가 남아 있는 동안 발송 허가를 얻은 요청은 모두 긴급 Delivery를 보낸다 (이미 시작된 대량 요청은 제외)',
  );
  it.todo('E2E-04 워커 3개 / 대량 알림 발송 → 429가 지속되지 않고 중복·누락 없이 끝난다');
  it.todo(
    'E2E-05 워커 3개로 발송 중 / 워커 하나를 강제로 멈춘다 → 남은 워커가 lease 만료분까지 이어받아 중복·누락 없이 끝난다',
  );
  it.todo(
    'E2E-06 대량 알림 발송 중 / 알림을 취소한다 → 새 발송이 멈추고, 이미 나간 건은 SENT로 남으며 나머지는 CANCELLED가 된다',
  );
});
