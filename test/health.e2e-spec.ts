import { afterAll, afterEach, beforeAll, beforeEach, describe, it, vi } from 'vitest';
import { INestApplication, Type } from '@nestjs/common';
import { HealthCheckResult } from '@nestjs/terminus';
import { Test, TestingModule } from '@nestjs/testing';
import { request, spec } from 'pactum';
import { Pool } from 'pg';
import { ReadinessPort } from '@/modules/health/application/port/readiness.port';
import { ProcessRole } from '@/shared/config/primitive.schema';
import { TestDatabase } from '@/shared/database/testing/test-database';

type RootModuleLoader = () => Promise<Type>;

type ProbeCase = Readonly<[ProcessRole, RootModuleLoader]>;

const ROOT_MODULES: ReadonlyArray<ProbeCase> = [
  ['api', async (): Promise<Type> => (await import('@/bootstrap/api.module.js')).ApiModule],
  [
    'worker',
    async (): Promise<Type> => (await import('@/bootstrap/worker.module.js')).WorkerModule,
  ],
];

const LIVE: HealthCheckResult = { status: 'ok', info: {}, error: {}, details: {} };

const READY: HealthCheckResult = {
  status: 'ok',
  info: { lifecycle: { status: 'up' }, database: { status: 'up' } },
  error: {},
  details: { lifecycle: { status: 'up' }, database: { status: 'up' } },
};

const SHUTTING_DOWN: HealthCheckResult = {
  status: 'error',
  info: { database: { status: 'up' } },
  error: { lifecycle: { status: 'down', reason: 'shutting down' } },
  details: {
    lifecycle: { status: 'down', reason: 'shutting down' },
    database: { status: 'up' },
  },
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
  (_role: ProcessRole, loadRootModule: RootModuleLoader) => {
    let testDatabase: TestDatabase;
    let rootModule: Type;
    let app: INestApplication;
    let closed: boolean;

    beforeAll(async (): Promise<void> => {
      testDatabase = await TestDatabase.create();
      vi.stubEnv('DATABASE_URL', testDatabase.databaseUrl);
      rootModule = await loadRootModule();
    });

    afterAll(async (): Promise<void> => {
      vi.unstubAllEnvs();
      await testDatabase.drop();
    });

    beforeEach(async (): Promise<void> => {
      closed = false;
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [rootModule],
      }).compile();
      app = moduleRef.createNestApplication();
      await app.listen(0, '127.0.0.1');
      request.setBaseUrl(await app.getUrl());
    });

    afterEach(async (): Promise<void> => {
      if (!closed) {
        await app.close();
      }
    });

    it('GET /livez는 200을 반환한다', async (): Promise<void> => {
      await spec().get('/livez').expectStatus(200).expectJson(LIVE);
    });

    it('GET /readyz는 정상 동작 중이고 DB에 쿼리할 수 있으면 200을 반환한다', async (): Promise<void> => {
      await spec().get('/readyz').expectStatus(200).expectJson(READY);
    });

    it('GET /readyz는 readiness가 내려가면 503을 반환하고 /livez는 200을 유지한다', async (): Promise<void> => {
      app.get(ReadinessPort).stopAcceptingTraffic();

      await spec().get('/readyz').expectStatus(503).expectJson(SHUTTING_DOWN);
      await spec().get('/livez').expectStatus(200).expectJson(LIVE);
    });

    it('GET /readyz는 DB에 쿼리할 수 없으면 503을 반환하고 /livez는 의존성을 보지 않아 200을 유지한다', async (): Promise<void> => {
      await app.get(Pool).end();

      await spec().get('/readyz').expectStatus(503).expectJson(DATABASE_DOWN);
      await spec().get('/livez').expectStatus(200).expectJson(LIVE);
    });

    it('app.close()가 진행되는 drain 동안 /readyz는 503, /livez는 200을 반환한다', async (): Promise<void> => {
      const closing: Promise<void> = app.close();
      closed = true;

      await spec().get('/readyz').expectStatus(503).expectJson(SHUTTING_DOWN);
      await spec().get('/livez').expectStatus(200).expectJson(LIVE);
      await closing;
    });
  },
);
