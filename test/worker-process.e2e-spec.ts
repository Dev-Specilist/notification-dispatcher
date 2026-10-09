import { randomUUID } from 'node:crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { setTimeout } from 'node:timers/promises';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { request, spec } from 'pactum';
import { Pool, QueryResult } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiModule } from '@/bootstrap/api.module';
import { WorkerProcess } from '@/bootstrap/testing/worker.process';
import { TestDatabase } from '@/shared/database/testing/test-database.helper';
import { createGate, Gate } from '@/shared/testing/gate.factory';

interface StatusCountRow {
  readonly status: string;
  readonly deliveries: number;
}

interface StubMockApi {
  readonly server: Server;
  readonly baseUrl: string;
  readonly sendRequests: Array<string>;
  readonly releaseSends: Gate;
}

const createdAlarmSchema = z.object({ id: z.string() });

type CreatedAlarm = z.infer<typeof createdAlarmSchema>;

const ACCEPTED_STATUS: number = 202;
const NOT_FOUND_STATUS: number = 404;
const QUIET_PERIOD_MS: number = 300;
const SHUTDOWN_TIMEOUT_SHORTER_THAN_REQUEST_MS: number = 2_000;

const portOf = (address: ReturnType<Server['address']>): number => {
  if (address && typeof address === 'object') {
    return address.port;
  }
  throw new Error(`server is not listening on a TCP port: ${String(address)}`);
};

const startStubMockApi = async (): Promise<StubMockApi> => {
  const sendRequests: Array<string> = [];
  const releaseSends: Gate = createGate();
  const server: Server = createServer(
    (incoming: IncomingMessage, outgoing: ServerResponse): void => {
      if (incoming.method !== 'POST' || incoming.url !== '/v1/messages') {
        outgoing.writeHead(NOT_FOUND_STATUS).end();
        return;
      }
      sendRequests.push(randomUUID());
      incoming.resume();
      void releaseSends.opened.then((): void => {
        outgoing
          .writeHead(ACCEPTED_STATUS, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ messageId: `m_${sendRequests.length}` }));
      });
    },
  );
  await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
    server.once('error', (error: Error): void => {
      server.close();
      reject(error);
    });
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    server,
    baseUrl: `http://127.0.0.1:${portOf(server.address())}`,
    sendRequests,
    releaseSends,
  };
};

describe('worker 프로세스', () => {
  let testDatabase: TestDatabase;
  let api: INestApplication;
  let buildDir: string;

  beforeAll(async (): Promise<void> => {
    buildDir = WorkerProcess.build();
    testDatabase = await TestDatabase.create();
    vi.stubEnv('DATABASE_URL', testDatabase.databaseUrl);
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [ApiModule.forRoot()],
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

  const deliveryStatusCounts = async (): Promise<ReadonlyArray<StatusCountRow>> => {
    const result: QueryResult<StatusCountRow> = await api
      .get(Pool)
      .query<StatusCountRow>(
        'SELECT status, count(*)::int AS deliveries FROM deliveries GROUP BY status ORDER BY status',
      );
    return result.rows;
  };

  it('E2E-07 실제 worker 자식 프로세스 / SIGTERM을 보낸다 → readiness가 내려가고 새 claim이 멈추며, 진행 중 요청을 마무리하고 exit 0으로 끝난다 (enableShutdownHooks의 useProcessExit: true)', async (): Promise<void> => {
    const createdAlarm: CreatedAlarm = createdAlarmSchema.parse(
      await spec()
        .post('/alarms')
        .withJson({
          title: '서버 점검',
          body: '10분 뒤 점검이 시작됩니다',
          kind: 'URGENT',
          recipientIds: ['u_000001', 'u_000002'],
        })
        .expectStatus(201)
        .returns('res.body'),
    );
    await spec().post(`/alarms/${createdAlarm.id}/dispatch`).expectStatus(202);
    const stubMockApi: StubMockApi = await startStubMockApi();
    try {
      const worker: WorkerProcess = await WorkerProcess.start(buildDir, {
        DATABASE_URL: testDatabase.databaseUrl,
        MOCK_API_URL: stubMockApi.baseUrl,
        DISPATCH_CONCURRENCY: '1',
        SHUTDOWN_DRAIN_MS: '200',
      });
      try {
        await vi.waitFor(
          (): void => {
            expect(stubMockApi.sendRequests).toHaveLength(1);
          },
          { timeout: 10_000, interval: 20 },
        );

        worker.terminate();
        await vi.waitFor(
          async (): Promise<void> => {
            expect(await worker.readinessStatus()).toBe(503);
          },
          { timeout: 2_000, interval: 20 },
        );
        stubMockApi.releaseSends.open();
        await worker.exited;
        await setTimeout(QUIET_PERIOD_MS);

        expect(worker.exitCode).toBe(0);
        expect(stubMockApi.sendRequests).toHaveLength(1);
        expect(await deliveryStatusCounts()).toEqual([
          { status: 'PENDING', deliveries: 1 },
          { status: 'SENT', deliveries: 1 },
        ]);
      } finally {
        await worker.kill();
      }
    } finally {
      stubMockApi.releaseSends.open();
      await new Promise<void>((resolve: () => void): void => {
        stubMockApi.server.close((): void => resolve());
      });
    }
  }, 60_000);

  it('E2E-08 응답하지 않는 발송 API에 요청 중인 실제 worker 자식 프로세스 / SIGTERM을 보낸다 → 제한 시간의 절반이 지나면 요청을 중단해 UNKNOWN으로 저장하고, lease를 남기지 않은 채 exit 0으로 끝난다', async (): Promise<void> => {
    const createdAlarm: CreatedAlarm = createdAlarmSchema.parse(
      await spec()
        .post('/alarms')
        .withJson({
          title: '결제 장애 안내',
          body: '결제가 지연되고 있습니다',
          kind: 'URGENT',
          recipientIds: ['u_000003'],
        })
        .expectStatus(201)
        .returns('res.body'),
    );
    await spec().post(`/alarms/${createdAlarm.id}/dispatch`).expectStatus(202);
    const stubMockApi: StubMockApi = await startStubMockApi();
    try {
      const worker: WorkerProcess = await WorkerProcess.start(buildDir, {
        DATABASE_URL: testDatabase.databaseUrl,
        MOCK_API_URL: stubMockApi.baseUrl,
        DISPATCH_CONCURRENCY: '1',
        SHUTDOWN_DRAIN_MS: '0',
        SHUTDOWN_TIMEOUT_MS: String(SHUTDOWN_TIMEOUT_SHORTER_THAN_REQUEST_MS),
      });
      try {
        await vi.waitFor(
          (): void => {
            expect(stubMockApi.sendRequests).toHaveLength(1);
          },
          { timeout: 10_000, interval: 20 },
        );

        worker.terminate();
        await worker.exited;

        expect(worker.exitCode).toBe(0);
        expect(worker.logs.join('')).toContain('aborting outgoing requests');
        expect(stubMockApi.sendRequests).toHaveLength(1);
        expect(
          (await deliveryStatusCounts()).filter(
            ({ status }: StatusCountRow): boolean => status === 'UNKNOWN' || status === 'IN_FLIGHT',
          ),
        ).toEqual([{ status: 'UNKNOWN', deliveries: 1 }]);
      } finally {
        await worker.kill();
      }
    } finally {
      stubMockApi.releaseSends.open();
      await new Promise<void>((resolve: () => void): void => {
        stubMockApi.server.close((): void => resolve());
      });
    }
  }, 60_000);
});
