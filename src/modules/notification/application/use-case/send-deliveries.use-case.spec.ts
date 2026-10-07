import { describe, it } from 'vitest';

describe('SendDeliveriesUseCase', () => {
  it.todo(
    'UC-09 대기 중 Delivery 여러 건 / 발송 유스케이스 → 발송 허가를 먼저 얻고, 그 시점에 발송 가능한 건 중 우선순위가 가장 높은 1건을 claim해 바로 보내며 결과를 fencing 조건으로 기록한다',
  );
  it.todo(
    'UC-10 발송 허가를 얻지 못했다 / 발송 유스케이스 → claim하지 않고 다음 주기를 기다린다 (claim한 채 허가를 기다리지 않는다)',
  );
  it.todo(
    'UC-11 429 응답 / 발송 유스케이스 → 공유 처리량 제한기에 Retry-After만큼 정지가 걸려 모든 워커가 함께 멈춘다',
  );
});
