import { describe, it } from 'vitest';

describe('알림 REST API', () => {
  it.todo('API-01 유효한 본문 / POST /alarms → 201과 알림 리소스');
  it.todo(
    'API-02 잘못된 본문 / POST /alarms → 400 Problem Details (VALIDATION_FAILED, 필드별 errors)',
  );
  it.todo(
    'API-03 알림 여러 개 / GET /alarms?status=&kind=&cursor=&limit= → 200 { items, page: { nextCursor } } (마지막 페이지는 nextCursor 필드 없음)',
  );
  it.todo('API-04 있는 알림 / GET /alarms/:id → 200과 Delivery 상태별 집계');
  it.todo('API-05 없는 알림 / GET /alarms/:id → 404 Problem Details (ALARM_NOT_FOUND)');
  it.todo('API-06 uuid가 아닌 id / GET /alarms/:id → 400 Problem Details');
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
