import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { INestApplication, Type } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { request, spec } from 'pactum';
import { Pool, QueryResult } from 'pg';
import { z } from 'zod';
import { TestDatabase } from '@/shared/database/testing/test-database';

type InvalidBodyCase = Readonly<
  [string, Readonly<Record<string, string | ReadonlyArray<string>>>, string]
>;

const createdAlarmSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  kind: z.string(),
  recipientIds: z.array(z.string()),
  status: z.string(),
  createdAt: z.string(),
});

type CreatedAlarm = z.infer<typeof createdAlarmSchema>;

const problemSchema = z.object({
  status: z.number(),
  code: z.string(),
  instance: z.string(),
  errors: z.array(z.object({ field: z.string(), message: z.string() })),
});

type Problem = z.infer<typeof problemSchema>;

interface StatusRow {
  readonly status: string;
}

const UUID: RegExp = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const PROBLEM_JSON: string = 'application/problem+json; charset=utf-8';

const ISO_UTC: RegExp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('알림 REST API', () => {
  let testDatabase: TestDatabase;
  let app: INestApplication;

  beforeAll(async (): Promise<void> => {
    testDatabase = await TestDatabase.create();
    vi.stubEnv('DATABASE_URL', testDatabase.databaseUrl);
    const rootModule: Type = (await import('@/bootstrap/api.module.js')).ApiModule;
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [rootModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    request.setBaseUrl(await app.getUrl());
  });

  afterAll(async (): Promise<void> => {
    await app.close();
    vi.unstubAllEnvs();
    await testDatabase.drop();
  });

  const storedStatus = async (alarmId: string): Promise<string> => {
    const result: QueryResult<StatusRow> = await app
      .get(Pool)
      .query<StatusRow>('SELECT status FROM alarms WHERE id = $1', [alarmId]);
    const [{ status }]: ReadonlyArray<StatusRow> = result.rows;
    return status;
  };

  it('API-01 유효한 본문 / POST /alarms → 201과 알림 리소스', async (): Promise<void> => {
    const created: CreatedAlarm = createdAlarmSchema.parse(
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

    expect(created).toEqual({
      id: expect.stringMatching(UUID),
      title: '서버 점검',
      body: '10분 뒤 점검이 시작됩니다',
      kind: 'URGENT',
      recipientIds: ['u_000001', 'u_000002'],
      status: 'DRAFT',
      createdAt: expect.stringMatching(ISO_UTC),
    });
    expect(await storedStatus(created.id)).toBe('DRAFT');
  });

  it('API-01 수신자를 생략한 대량 알림은 전체 사용자 대상으로 만들어진다', async (): Promise<void> => {
    const created: CreatedAlarm = createdAlarmSchema.parse(
      await spec()
        .post('/alarms')
        .withJson({ title: '추석 이벤트', body: '연휴 쿠폰이 도착했어요', kind: 'BULK' })
        .expectStatus(201)
        .returns('res.body'),
    );

    expect(created).toMatchObject({ kind: 'BULK', recipientIds: [], status: 'DRAFT' });
    expect(await storedStatus(created.id)).toBe('DRAFT');
  });

  it.each<InvalidBodyCase>([
    ['제목이 없다', { body: '본문', kind: 'BULK' }, 'title'],
    ['알 수 없는 종류다', { title: '제목', body: '본문', kind: 'PUSH' }, 'kind'],
    ['제목이 공백뿐이다', { title: '   ', body: '본문', kind: 'BULK' }, 'title'],
    [
      '대량 알림에 수신자를 지정했다',
      { title: '제목', body: '본문', kind: 'BULK', recipientIds: ['u_000001'] },
      'recipientIds',
    ],
    [
      '긴급 알림에 수신자가 없다',
      { title: '제목', body: '본문', kind: 'URGENT', recipientIds: [] },
      'recipientIds',
    ],
    ['제목에 NUL 문자가 있다', { title: '제목\u0000', body: '본문', kind: 'BULK' }, 'title'],
    ['본문에 NUL 문자가 있다', { title: '제목', body: '본\u0000문', kind: 'BULK' }, 'body'],
    [
      '수신자 id에 NUL 문자가 있다',
      { title: '제목', body: '본문', kind: 'URGENT', recipientIds: ['u_00\u00000001'] },
      'recipientIds.0',
    ],
    [
      '긴급 알림에 형식이 잘못된 수신자 id가 있다',
      { title: '제목', body: '본문', kind: 'URGENT', recipientIds: ['bad id'] },
      'recipientIds',
    ],
  ])(
    'API-02 잘못된 본문(%s) / POST /alarms → 400 Problem Details (VALIDATION_FAILED, 필드별 errors)',
    async (
      _label: string,
      body: Readonly<Record<string, string | ReadonlyArray<string>>>,
      field: string,
    ): Promise<void> => {
      const problem: Problem = problemSchema.parse(
        await spec().post('/alarms').withJson(body).expectStatus(400).returns('res.body'),
      );

      expect(problem).toMatchObject({
        status: 400,
        code: 'VALIDATION_FAILED',
        instance: '/alarms',
      });
      expect(problem.errors).toContainEqual({ field, message: expect.any(String) });
    },
  );

  it.todo(
    'API-03 알림 여러 개 / GET /alarms?status=&kind=&cursor=&limit= → 200 { items, page: { nextCursor } } (마지막 페이지는 nextCursor 필드 없음)',
  );
  it.todo('API-04 있는 알림 / GET /alarms/:id → 200과 Delivery 상태별 집계');
  it('있는 알림 / GET /alarms/:id → 200과 만들 때와 같은 알림 리소스', async (): Promise<void> => {
    const created: CreatedAlarm = createdAlarmSchema.parse(
      await spec()
        .post('/alarms')
        .withJson({ title: '추석 이벤트', body: '연휴 쿠폰이 도착했어요', kind: 'BULK' })
        .expectStatus(201)
        .returns('res.body'),
    );

    const fetched: CreatedAlarm = createdAlarmSchema.parse(
      await spec().get(`/alarms/${created.id}`).expectStatus(200).returns('res.body'),
    );

    expect(fetched).toEqual(created);
  });

  it('API-05 없는 알림 / GET /alarms/:id → 404 Problem Details (ALARM_NOT_FOUND)', async (): Promise<void> => {
    const missingId: string = '7d3f1e2a-4b5c-4d6e-8f70-1a2b3c4d5e6f';

    const problem: Problem = problemSchema.parse(
      await spec()
        .get(`/alarms/${missingId}`)
        .expectStatus(404)
        .expectHeader('content-type', PROBLEM_JSON)
        .returns('res.body'),
    );

    expect(problem).toEqual({
      status: 404,
      code: 'ALARM_NOT_FOUND',
      instance: `/alarms/${missingId}`,
      errors: [],
    });
  });

  it('API-06 uuid가 아닌 id / GET /alarms/:id → 400 Problem Details', async (): Promise<void> => {
    const problem: Problem = problemSchema.parse(
      await spec()
        .get('/alarms/not-a-uuid')
        .expectStatus(400)
        .expectHeader('content-type', PROBLEM_JSON)
        .returns('res.body'),
    );

    expect(problem).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      instance: '/alarms/not-a-uuid',
    });
    expect(problem.errors).toContainEqual({ field: 'id', message: expect.any(String) });
  });
  it.todo('API-07 DRAFT 알림 / POST /alarms/:id/dispatch → 202와 DISPATCHING 알림');
  it.todo(
    'API-08 이미 시작한 알림 / POST /alarms/:id/dispatch → 409 Problem Details (ALARM_STATE_CONFLICT)',
  );
  it.todo('API-09 DRAFT·DISPATCHING 알림 / POST /alarms/:id/cancel → 200과 CANCELLED 알림');
  it.todo(
    'API-10 종결된 알림 / POST /alarms/:id/cancel → 409 Problem Details (ALARM_STATE_CONFLICT)',
  );
  it.todo('API-11 실행 중인 api / GET /docs-json → OpenAPI 3 문서가 나온다');
});
