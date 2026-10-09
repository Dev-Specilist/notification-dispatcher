import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  MockInstance,
  vi,
} from 'vitest';
import { ConsoleLogger, DynamicModule, INestApplication } from '@nestjs/common';
import { HealthCheckResult } from '@nestjs/terminus';
import { Test, TestingModule } from '@nestjs/testing';
import { request, spec } from 'pactum';
import { Pool } from 'pg';
import { ApiModule } from '@/bootstrap/api.module';
import { WorkerModule } from '@/bootstrap/worker.module';
import { ReadinessPort } from '@/modules/health/application/port/driven/for-tracking-readiness/readiness.port';
import { ProcessRole } from '@/shared/config/primitive.type';
import { TestDatabase } from '@/shared/database/testing/test-database.helper';

type RootModuleFactory = () => DynamicModule;

type ProbeCase = Readonly<[ProcessRole, RootModuleFactory]>;

type ErrorLogSpy = MockInstance<ConsoleLogger['error']>;

type ErrorLogCall = Parameters<ConsoleLogger['error']>;

const HEALTH_CHECK_FAILED: string = 'Health Check has failed!';

const WORKER_PASS_FAILED: string = 'pass failed';

const ROOT_MODULES: ReadonlyArray<ProbeCase> = [
  ['api', (): DynamicModule => ApiModule.forRoot()],
  ['worker', (): DynamicModule => WorkerModule.forRoot()],
];

const LIVE: HealthCheckResult = { status: 'ok', info: {}, error: {}, details: {} };

const READY: HealthCheckResult = {
  status: 'ok',
  info: { lifecycle: { status: 'up' }, database: { status: 'up' } },
  error: {},
  details: { lifecycle: { status: 'up' }, database: { status: 'up' } },
};

type LifecycleDownMatch = Pick<HealthCheckResult, 'status' | 'error'>;

const SHUTTING_DOWN: LifecycleDownMatch = {
  status: 'error',
  error: { lifecycle: { status: 'down', reason: 'shutting down' } },
};

const DATABASE_DOWN: HealthCheckResult = {
  status: 'error',
  info: { lifecycle: { status: 'up' } },
  error: { database: { status: 'down', reason: 'database unreachable' } },
  details: {
    lifecycle: { status: 'up' },
    database: { status: 'down', reason: 'database unreachable' },
  },
};

describe.each(ROOT_MODULES)(
  '%s 헬스 프로브',
  (role: ProcessRole, createRootModule: RootModuleFactory) => {
    let testDatabase: TestDatabase;
    let app: INestApplication;
    let closed: boolean;
    let errorLog: ErrorLogSpy;

    const loggedErrors = (): ReadonlyArray<string> =>
      errorLog.mock.calls.map(([message]: ErrorLogCall): string => String(message));

    beforeAll(async (): Promise<void> => {
      testDatabase = await TestDatabase.create();
      vi.stubEnv('DATABASE_URL', testDatabase.databaseUrl);
    });

    afterAll(async (): Promise<void> => {
      vi.unstubAllEnvs();
      await testDatabase.drop();
    });

    beforeEach(async (): Promise<void> => {
      closed = false;
      errorLog = vi.spyOn(ConsoleLogger.prototype, 'error').mockImplementation((): void => {});
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [createRootModule()],
      }).compile();
      app = moduleRef.createNestApplication();
      await app.listen(0, '127.0.0.1');
      request.setBaseUrl(await app.getUrl());
    });

    afterEach(async (): Promise<void> => {
      if (!closed) {
        await app.close();
      }
      vi.restoreAllMocks();
    });

    it('GET /livez는 200을 반환한다', async (): Promise<void> => {
      await spec().get('/livez').expectStatus(200).expectJson(LIVE);

      expect(loggedErrors()).toEqual([]);
    });

    it('GET /readyz는 정상 동작 중이고 DB에 쿼리할 수 있으면 200을 반환한다', async (): Promise<void> => {
      await spec().get('/readyz').expectStatus(200).expectJson(READY);

      expect(loggedErrors()).toEqual([]);
    });

    it('GET /readyz는 readiness가 내려가면 503을 반환하고 /livez는 200을 유지한다', async (): Promise<void> => {
      app.get(ReadinessPort).stopAcceptingTraffic();

      await spec().get('/readyz').expectStatus(503).expectJsonLike(SHUTTING_DOWN);
      await spec().get('/livez').expectStatus(200).expectJson(LIVE);

      expect(loggedErrors()).toEqual([expect.stringContaining(HEALTH_CHECK_FAILED)]);
    });

    it('GET /readyz는 DB에 쿼리할 수 없으면 503을 반환하고 /livez는 의존성을 보지 않아 200을 유지한다', async (): Promise<void> => {
      await app.get(Pool).end();

      await spec().get('/readyz').expectStatus(503).expectJson(DATABASE_DOWN);
      await spec().get('/livez').expectStatus(200).expectJson(LIVE);

      expect(loggedErrors()).toContainEqual(expect.stringContaining(HEALTH_CHECK_FAILED));
      await vi.waitFor((): void => {
        expect(
          loggedErrors().some((message: string): boolean => message.includes(WORKER_PASS_FAILED)),
        ).toBe(role === 'worker');
      });
    });

    it('app.close()가 진행되는 drain 동안 /readyz는 503, /livez는 200을 반환한다', async (): Promise<void> => {
      const closing: Promise<void> = app.close();
      closed = true;

      await spec().get('/readyz').expectStatus(503).expectJsonLike(SHUTTING_DOWN);
      await spec().get('/livez').expectStatus(200).expectJson(LIVE);
      await closing;

      expect(loggedErrors()).toEqual([expect.stringContaining(HEALTH_CHECK_FAILED)]);
    });
  },
);
