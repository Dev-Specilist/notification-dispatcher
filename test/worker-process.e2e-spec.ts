import { ChildProcessWithoutNullStreams, execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import net from 'node:net';
import { join } from 'node:path';
import { INestApplication, Type } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { request, spec } from 'pactum';
import { Pool, QueryResult } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { TestDatabase } from '@/shared/database/testing/test-database';

interface Gate {
  readonly opened: Promise<void>;
  readonly open: () => void;
}

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

const BUILD_ROOT: string = join(process.cwd(), 'node_modules', '.cache', 'worker-process-e2e');
const BUILD_DIR: string = join(BUILD_ROOT, randomUUID());
const SWC_BIN: string = join(process.cwd(), 'node_modules', '.bin', 'swc');
const ACCEPTED_STATUS: number = 202;
const NOT_FOUND_STATUS: number = 404;
const QUIET_PERIOD_MS: number = 300;

const NOT_YET_OPENED: () => void = (): void => {};

const createGate = (): Gate => {
  let release: () => void = NOT_YET_OPENED;
  const opened: Promise<void> = new Promise<void>((resolve: () => void): void => {
    release = resolve;
  });
  return { opened, open: (): void => release() };
};

const portOf = (address: ReturnType<Server['address']>): number => {
  if (address && typeof address === 'object') {
    return address.port;
  }
  throw new Error(`server is not listening on a TCP port: ${String(address)}`);
};

const freePort = async (): Promise<number> => {
  const probe: net.Server = net.createServer();
  await new Promise<void>((resolve: () => void): void => {
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port: number = portOf(probe.address());
  await new Promise<void>((resolve: () => void): void => {
    probe.close((): void => resolve());
  });
  return port;
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
  await new Promise<void>((resolve: () => void): void => {
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    server,
    baseUrl: `http://127.0.0.1:${portOf(server.address())}`,
    sendRequests,
    releaseSends,
  };
};

const readinessStatus = async (workerUrl: string): Promise<number> => {
  const response: Response = await fetch(`${workerUrl}/readyz`);
  await response.arrayBuffer();
  return response.status;
};

describe('worker 프로세스', () => {
  let testDatabase: TestDatabase;
  let api: INestApplication;

  beforeAll(async (): Promise<void> => {
    execFileSync(SWC_BIN, ['src', '-d', BUILD_DIR, '--strip-leading-paths']);
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
    await rm(BUILD_DIR, { recursive: true, force: true });
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
    const workerPort: number = await freePort();
    const workerUrl: string = `http://127.0.0.1:${workerPort}`;
    const workerLogs: Array<string> = [];
    const worker: ChildProcessWithoutNullStreams = spawn(
      process.execPath,
      ['--enable-source-maps', join(BUILD_DIR, 'worker.js')],
      {
        env: {
          DATABASE_URL: testDatabase.databaseUrl,
          MOCK_API_URL: stubMockApi.baseUrl,
          HOST: '127.0.0.1',
          PORT: String(workerPort),
          DISPATCH_CONCURRENCY: '1',
          SHUTDOWN_DRAIN_MS: '200',
          LOG_FORMAT: 'json',
        },
      },
    );
    const exited: Promise<void> = new Promise<void>((resolve: () => void): void => {
      worker.once('exit', (): void => resolve());
    });
    worker.stdout.on('data', (chunk: Buffer): void => {
      workerLogs.push(chunk.toString());
    });
    worker.stderr.on('data', (chunk: Buffer): void => {
      workerLogs.push(chunk.toString());
    });

    try {
      await vi.waitFor(
        async (): Promise<void> => {
          expect(await readinessStatus(workerUrl)).toBe(200);
        },
        { timeout: 15_000, interval: 100 },
      );
      await vi.waitFor(
        (): void => {
          expect(stubMockApi.sendRequests).toHaveLength(1);
        },
        { timeout: 10_000, interval: 20 },
      );

      worker.kill('SIGTERM');
      await vi.waitFor(
        async (): Promise<void> => {
          expect(await readinessStatus(workerUrl)).toBe(503);
        },
        { timeout: 2_000, interval: 20 },
      );
      stubMockApi.releaseSends.open();
      await exited;
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, QUIET_PERIOD_MS);
      });

      expect({ exitCode: worker.exitCode, logs: workerLogs }).toMatchObject({ exitCode: 0 });
      expect(stubMockApi.sendRequests).toHaveLength(1);
      expect(await deliveryStatusCounts()).toEqual([
        { status: 'PENDING', deliveries: 1 },
        { status: 'SENT', deliveries: 1 },
      ]);
    } finally {
      stubMockApi.releaseSends.open();
      worker.kill('SIGKILL');
      await new Promise<void>((resolve: () => void): void => {
        stubMockApi.server.close((): void => resolve());
      });
    }
  }, 60_000);
});
