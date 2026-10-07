import { afterEach, beforeEach, describe, it } from 'vitest';
import { INestApplication, Type } from '@nestjs/common';
import { HealthCheckResult } from '@nestjs/terminus';
import { Test, TestingModule } from '@nestjs/testing';
import { request, spec } from 'pactum';
import { ApiModule } from '@/bootstrap/api.module';
import { WorkerModule } from '@/bootstrap/worker.module';
import { ReadinessPort } from '@/modules/health/application/port/readiness.port';
import { ProcessRole } from '@/shared/config/primitive.schema';

type ProbeCase = Readonly<[ProcessRole, Type]>;

const ROOT_MODULES: ReadonlyArray<ProbeCase> = [
  ['api', ApiModule],
  ['worker', WorkerModule],
];

const LIVE: HealthCheckResult = { status: 'ok', info: {}, error: {}, details: {} };

const READY: HealthCheckResult = {
  status: 'ok',
  info: { lifecycle: { status: 'up' } },
  error: {},
  details: { lifecycle: { status: 'up' } },
};

const SHUTTING_DOWN: HealthCheckResult = {
  status: 'error',
  info: {},
  error: { lifecycle: { status: 'down', reason: 'shutting down' } },
  details: { lifecycle: { status: 'down', reason: 'shutting down' } },
};

describe.each(ROOT_MODULES)('%s 헬스 프로브', (_role: ProcessRole, rootModule: Type) => {
  let app: INestApplication;
  let closed: boolean;

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

  it('GET /readyz는 정상 동작 중이면 200을 반환한다', async (): Promise<void> => {
    await spec().get('/readyz').expectStatus(200).expectJson(READY);
  });

  it('GET /readyz는 readiness가 내려가면 503을 반환하고 /livez는 200을 유지한다', async (): Promise<void> => {
    app.get(ReadinessPort).stopAcceptingTraffic();

    await spec().get('/readyz').expectStatus(503).expectJson(SHUTTING_DOWN);
    await spec().get('/livez').expectStatus(200).expectJson(LIVE);
  });

  it('app.close()가 진행되는 drain 동안 /readyz는 503, /livez는 200을 반환한다', async (): Promise<void> => {
    const closing: Promise<void> = app.close();
    closed = true;

    await spec().get('/readyz').expectStatus(503).expectJson(SHUTTING_DOWN);
    await spec().get('/livez').expectStatus(200).expectJson(LIVE);
    await closing;
  });
});
