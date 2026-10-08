import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { INestApplication, Type } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { request, spec } from 'pactum';
import { Pool, QueryResult } from 'pg';
import { z } from 'zod';
import { TestDatabase } from '@/shared/database/testing/test-database';

type InvalidListQueryCase = Readonly<
  [label: string, query: Readonly<Record<string, string>>, field: string]
>;

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

const dispatchedAlarmSchema = createdAlarmSchema.extend({ dispatchedAt: z.string() });

type DispatchedAlarm = z.infer<typeof dispatchedAlarmSchema>;

const cancelledBeforeDispatchSchema = createdAlarmSchema
  .extend({ cancelledAt: z.string() })
  .strict();

type CancelledBeforeDispatch = z.infer<typeof cancelledBeforeDispatchSchema>;

const cancelledAfterDispatchSchema = dispatchedAlarmSchema.extend({ cancelledAt: z.string() });

type CancelledAfterDispatch = z.infer<typeof cancelledAfterDispatchSchema>;

const alarmDetailSchema = createdAlarmSchema.extend({
  deliveries: z.object({
    total: z.number(),
    byStatus: z.record(z.string(), z.number()),
  }),
});

type AlarmDetail = z.infer<typeof alarmDetailSchema>;

const morePagesSchema = z.object({
  items: z.array(createdAlarmSchema),
  page: z.object({ nextCursor: z.string() }).strict(),
});

type MorePages = z.infer<typeof morePagesSchema>;

const lastPageSchema = z.object({
  items: z.array(createdAlarmSchema),
  page: z.object({}).strict(),
});

type LastPage = z.infer<typeof lastPageSchema>;

const anyPageSchema = z.union([morePagesSchema, lastPageSchema]);

type AnyPage = z.infer<typeof anyPageSchema>;

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

interface ExpansionJobCountRow {
  readonly jobs: number;
}

const UUID: RegExp = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const PROBLEM_JSON: string = 'application/problem+json; charset=utf-8';

const ISO_UTC: RegExp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const createBulkAlarm = async (title: string): Promise<CreatedAlarm> =>
  createdAlarmSchema.parse(
    await spec()
      .post('/alarms')
      .withJson({ title, body: '목록 조회 확인', kind: 'BULK' })
      .expectStatus(201)
      .returns('res.body'),
  );

const createUrgentAlarm = async (recipientIds: ReadonlyArray<string>): Promise<CreatedAlarm> =>
  createdAlarmSchema.parse(
    await spec()
      .post('/alarms')
      .withJson({
        title: '서버 점검',
        body: '10분 뒤 점검이 시작됩니다',
        kind: 'URGENT',
        recipientIds,
      })
      .expectStatus(201)
      .returns('res.body'),
  );

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

  const expansionJobCountOf = async (alarmId: string): Promise<number> => {
    const result: QueryResult<ExpansionJobCountRow> = await app
      .get(Pool)
      .query<ExpansionJobCountRow>(
        'SELECT count(*)::int AS jobs FROM expansion_jobs WHERE alarm_id = $1',
        [alarmId],
      );
    const [{ jobs }]: ReadonlyArray<ExpansionJobCountRow> = result.rows;
    return jobs;
  };

  it('API-01 유효한 본문 / POST /alarms → 201과 알림 리소스', async (): Promise<void> => {
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

    expect(createdAlarm).toEqual({
      id: expect.stringMatching(UUID),
      title: '서버 점검',
      body: '10분 뒤 점검이 시작됩니다',
      kind: 'URGENT',
      recipientIds: ['u_000001', 'u_000002'],
      status: 'DRAFT',
      createdAt: expect.stringMatching(ISO_UTC),
    });
    expect(await storedStatus(createdAlarm.id)).toBe('DRAFT');
  });

  it('API-01 수신자를 생략한 대량 알림은 전체 사용자 대상으로 만들어진다', async (): Promise<void> => {
    const createdAlarm: CreatedAlarm = createdAlarmSchema.parse(
      await spec()
        .post('/alarms')
        .withJson({ title: '추석 이벤트', body: '연휴 쿠폰이 도착했어요', kind: 'BULK' })
        .expectStatus(201)
        .returns('res.body'),
    );

    expect(createdAlarm).toMatchObject({ kind: 'BULK', recipientIds: [], status: 'DRAFT' });
    expect(await storedStatus(createdAlarm.id)).toBe('DRAFT');
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

  it('API-03 알림 여러 개 / GET /alarms?status=&kind=&cursor=&limit= → 200 { items, page: { nextCursor } } (마지막 페이지는 nextCursor 필드 없음)', async (): Promise<void> => {
    const oldestAlarm: CreatedAlarm = await createBulkAlarm('목록 1');
    const middleAlarm: CreatedAlarm = await createBulkAlarm('목록 2');
    await createUrgentAlarm(['u_000001']);
    const newestAlarm: CreatedAlarm = await createBulkAlarm('목록 3');
    const dispatchedBulkAlarm: CreatedAlarm = await createBulkAlarm('목록 발송 중');
    await spec().post(`/alarms/${dispatchedBulkAlarm.id}/dispatch`).expectStatus(202);

    const firstPage: MorePages = morePagesSchema.parse(
      await spec()
        .get('/alarms')
        .withQueryParams({ status: 'DRAFT', kind: 'BULK', limit: 2 })
        .expectStatus(200)
        .returns('res.body'),
    );
    const secondPage: AnyPage = anyPageSchema.parse(
      await spec()
        .get('/alarms')
        .withQueryParams({
          status: 'DRAFT',
          kind: 'BULK',
          limit: 2,
          cursor: firstPage.page.nextCursor,
        })
        .expectStatus(200)
        .returns('res.body'),
    );

    expect(firstPage.items).toEqual([newestAlarm, middleAlarm]);
    expect(secondPage.items[0]).toEqual(oldestAlarm);
  });

  it('API-03 조건에 맞는 알림이 더 없으면 마지막 페이지로 nextCursor 필드 없이 응답한다', async (): Promise<void> => {
    const cancelledBulkAlarm: CreatedAlarm = await createBulkAlarm('목록 취소');
    await spec().post(`/alarms/${cancelledBulkAlarm.id}/cancel`).expectStatus(200);

    const lastPage: LastPage = lastPageSchema.parse(
      await spec()
        .get('/alarms')
        .withQueryParams({ status: 'CANCELLED', kind: 'BULK', limit: 100 })
        .expectStatus(200)
        .returns('res.body'),
    );

    expect(lastPage.items.map(({ id: alarmId }: CreatedAlarm): string => alarmId)).toContain(
      cancelledBulkAlarm.id,
    );
    expect(lastPage.page).toEqual({});
  });

  it('API-03 발급한 cursor 뒤에 base64url 밖의 문자를 붙이면 400 Problem Details', async (): Promise<void> => {
    await createBulkAlarm('목록 cursor 확인 1');
    await createBulkAlarm('목록 cursor 확인 2');
    const firstPage: MorePages = morePagesSchema.parse(
      await spec()
        .get('/alarms')
        .withQueryParams({ status: 'DRAFT', kind: 'BULK', limit: 1 })
        .expectStatus(200)
        .returns('res.body'),
    );

    const problem: Problem = problemSchema.parse(
      await spec()
        .get('/alarms')
        .withQueryParams({ status: 'DRAFT', kind: 'BULK', cursor: `${firstPage.page.nextCursor}!` })
        .expectStatus(400)
        .returns('res.body'),
    );

    expect(problem.errors).toContainEqual({ field: 'cursor', message: expect.any(String) });
  });

  it.each<InvalidListQueryCase>([
    ['해석할 수 없는 cursor', { cursor: 'not-a-cursor' }, 'cursor'],
    ['범위를 벗어난 limit', { limit: '0' }, 'limit'],
    ['정해지지 않은 상태 필터', { status: 'UNKNOWN' }, 'status'],
  ])(
    'API-03 %s / GET /alarms → 400 Problem Details',
    async (
      _label: string,
      query: Readonly<Record<string, string>>,
      field: string,
    ): Promise<void> => {
      const problem: Problem = problemSchema.parse(
        await spec()
          .get('/alarms')
          .withQueryParams(query)
          .expectStatus(400)
          .expectHeader('content-type', PROBLEM_JSON)
          .returns('res.body'),
      );

      expect(problem).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
      expect(problem.errors).toContainEqual({ field, message: expect.any(String) });
    },
  );

  it('API-04 있는 알림 / GET /alarms/:id → 200과 Delivery 상태별 집계', async (): Promise<void> => {
    const createdAlarm: CreatedAlarm = createdAlarmSchema.parse(
      await spec()
        .post('/alarms')
        .withJson({ title: '추석 이벤트', body: '연휴 쿠폰이 도착했어요', kind: 'BULK' })
        .expectStatus(201)
        .returns('res.body'),
    );

    const fetchedAlarm: AlarmDetail = alarmDetailSchema.parse(
      await spec().get(`/alarms/${createdAlarm.id}`).expectStatus(200).returns('res.body'),
    );

    expect(fetchedAlarm).toEqual({
      ...createdAlarm,
      deliveries: {
        total: 0,
        byStatus: {
          PENDING: 0,
          IN_FLIGHT: 0,
          RETRY_WAIT: 0,
          UNKNOWN: 0,
          SENT: 0,
          FAILED: 0,
          UNCONFIRMED: 0,
          CANCELLED: 0,
        },
      },
    });
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
  it('API-07 DRAFT 알림 / POST /alarms/:id/dispatch → 202와 DISPATCHING 알림', async (): Promise<void> => {
    const createdAlarm: CreatedAlarm = await createUrgentAlarm(['u_000001', 'u_000002']);

    const dispatchedAlarm: DispatchedAlarm = dispatchedAlarmSchema.parse(
      await spec()
        .post(`/alarms/${createdAlarm.id}/dispatch`)
        .expectStatus(202)
        .returns('res.body'),
    );

    expect(dispatchedAlarm).toEqual({
      ...createdAlarm,
      status: 'DISPATCHING',
      dispatchedAt: expect.stringMatching(ISO_UTC),
    });
    expect(await storedStatus(createdAlarm.id)).toBe('DISPATCHING');
  });

  it('API-07 대량 DRAFT 알림 / POST /alarms/:id/dispatch → 202와 DISPATCHING 알림, 확장 작업이 생기고 Delivery는 아직 없다', async (): Promise<void> => {
    const createdAlarm: CreatedAlarm = createdAlarmSchema.parse(
      await spec()
        .post('/alarms')
        .withJson({ title: '추석 이벤트', body: '연휴 쿠폰이 도착했어요', kind: 'BULK' })
        .expectStatus(201)
        .returns('res.body'),
    );

    const dispatchedAlarm: DispatchedAlarm = dispatchedAlarmSchema.parse(
      await spec()
        .post(`/alarms/${createdAlarm.id}/dispatch`)
        .expectStatus(202)
        .returns('res.body'),
    );

    expect(dispatchedAlarm).toMatchObject({ kind: 'BULK', status: 'DISPATCHING' });
    expect(await expansionJobCountOf(createdAlarm.id)).toBe(1);
    expect(
      alarmDetailSchema.parse(
        await spec().get(`/alarms/${createdAlarm.id}`).expectStatus(200).returns('res.body'),
      ).deliveries.total,
    ).toBe(0);
  });

  it('API-08 이미 시작한 알림 / POST /alarms/:id/dispatch → 409 Problem Details (ALARM_STATE_CONFLICT)', async (): Promise<void> => {
    const createdAlarm: CreatedAlarm = await createUrgentAlarm(['u_000001']);
    await spec().post(`/alarms/${createdAlarm.id}/dispatch`).expectStatus(202);

    const problem: Problem = problemSchema.parse(
      await spec()
        .post(`/alarms/${createdAlarm.id}/dispatch`)
        .expectStatus(409)
        .expectHeader('content-type', PROBLEM_JSON)
        .returns('res.body'),
    );

    expect(problem).toEqual({
      status: 409,
      code: 'ALARM_STATE_CONFLICT',
      instance: `/alarms/${createdAlarm.id}/dispatch`,
      errors: [],
    });
  });

  it('없는 알림 / POST /alarms/:id/dispatch → 404 Problem Details (ALARM_NOT_FOUND)', async (): Promise<void> => {
    const missingAlarmId: string = '7d3f1e2a-4b5c-4d6e-8f70-1a2b3c4d5e6f';

    const problem: Problem = problemSchema.parse(
      await spec().post(`/alarms/${missingAlarmId}/dispatch`).expectStatus(404).returns('res.body'),
    );

    expect(problem).toMatchObject({ status: 404, code: 'ALARM_NOT_FOUND' });
  });

  it('API-04 발송을 시작한 긴급 알림은 수신자 수만큼 PENDING으로 집계되고 다른 알림의 Delivery는 세지 않는다', async (): Promise<void> => {
    const targetAlarm: CreatedAlarm = await createUrgentAlarm(['u_000001', 'u_000002']);
    const otherAlarm: CreatedAlarm = await createUrgentAlarm(['u_000001', 'u_000002', 'u_000003']);
    await spec().post(`/alarms/${targetAlarm.id}/dispatch`).expectStatus(202);
    await spec().post(`/alarms/${otherAlarm.id}/dispatch`).expectStatus(202);

    const fetchedAlarm: AlarmDetail = alarmDetailSchema.parse(
      await spec().get(`/alarms/${targetAlarm.id}`).expectStatus(200).returns('res.body'),
    );

    expect(fetchedAlarm.deliveries).toEqual({
      total: 2,
      byStatus: {
        PENDING: 2,
        IN_FLIGHT: 0,
        RETRY_WAIT: 0,
        UNKNOWN: 0,
        SENT: 0,
        FAILED: 0,
        UNCONFIRMED: 0,
        CANCELLED: 0,
      },
    });
  });
  it('API-09 DRAFT·DISPATCHING 알림 / POST /alarms/:id/cancel → 200과 CANCELLED 알림', async (): Promise<void> => {
    const createdAlarm: CreatedAlarm = await createUrgentAlarm(['u_000001']);

    const cancelledAlarm: CancelledBeforeDispatch = cancelledBeforeDispatchSchema.parse(
      await spec().post(`/alarms/${createdAlarm.id}/cancel`).expectStatus(200).returns('res.body'),
    );

    expect(cancelledAlarm).toEqual({
      ...createdAlarm,
      status: 'CANCELLED',
      cancelledAt: expect.stringMatching(ISO_UTC),
    });
    expect(await storedStatus(createdAlarm.id)).toBe('CANCELLED');
  });

  it('API-09 발송 중인 알림을 취소하면 200과 발송 시각이 남은 CANCELLED 알림이 오고, 대기 Delivery는 CANCELLED로 집계된다', async (): Promise<void> => {
    const createdAlarm: CreatedAlarm = await createUrgentAlarm(['u_000001', 'u_000002']);
    const dispatchedAlarm: DispatchedAlarm = dispatchedAlarmSchema.parse(
      await spec()
        .post(`/alarms/${createdAlarm.id}/dispatch`)
        .expectStatus(202)
        .returns('res.body'),
    );

    const cancelledAlarm: CancelledAfterDispatch = cancelledAfterDispatchSchema.parse(
      await spec().post(`/alarms/${createdAlarm.id}/cancel`).expectStatus(200).returns('res.body'),
    );
    const fetchedAlarm: AlarmDetail = alarmDetailSchema.parse(
      await spec().get(`/alarms/${createdAlarm.id}`).expectStatus(200).returns('res.body'),
    );

    expect(cancelledAlarm).toMatchObject({
      status: 'CANCELLED',
      dispatchedAt: dispatchedAlarm.dispatchedAt,
      cancelledAt: expect.stringMatching(ISO_UTC),
    });
    expect(fetchedAlarm.deliveries).toMatchObject({
      total: 2,
      byStatus: { PENDING: 0, CANCELLED: 2 },
    });
  });

  it('API-10 종결된 알림 / POST /alarms/:id/cancel → 409 Problem Details (ALARM_STATE_CONFLICT)', async (): Promise<void> => {
    const createdAlarm: CreatedAlarm = await createUrgentAlarm(['u_000001']);
    await spec().post(`/alarms/${createdAlarm.id}/cancel`).expectStatus(200);

    const problem: Problem = problemSchema.parse(
      await spec()
        .post(`/alarms/${createdAlarm.id}/cancel`)
        .expectStatus(409)
        .expectHeader('content-type', PROBLEM_JSON)
        .returns('res.body'),
    );

    expect(problem).toEqual({
      status: 409,
      code: 'ALARM_STATE_CONFLICT',
      instance: `/alarms/${createdAlarm.id}/cancel`,
      errors: [],
    });
  });

  it('없는 알림 / POST /alarms/:id/cancel → 404 Problem Details (ALARM_NOT_FOUND)', async (): Promise<void> => {
    const missingAlarmId: string = '7d3f1e2a-4b5c-4d6e-8f70-1a2b3c4d5e6f';

    const problem: Problem = problemSchema.parse(
      await spec().post(`/alarms/${missingAlarmId}/cancel`).expectStatus(404).returns('res.body'),
    );

    expect(problem).toMatchObject({ status: 404, code: 'ALARM_NOT_FOUND' });
  });
  it.todo('API-11 실행 중인 api / GET /docs-json → OpenAPI 3 문서가 나온다');
});
