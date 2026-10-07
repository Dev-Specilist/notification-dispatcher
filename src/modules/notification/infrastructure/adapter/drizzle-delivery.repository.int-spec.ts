import { describe, it } from 'vitest';

describe('DrizzleDeliveryRepository', () => {
  it.todo(
    'DB-06 대기 Delivery 100건 / 워커 3개가 동시에 claim한다 (FOR UPDATE SKIP LOCKED) → 같은 Delivery를 두 워커가 가져가지 않는다',
  );
  it.todo('DB-07 같은 (알림, 수신자) / Delivery를 두 번 만든다 → unique 제약으로 하나만 남는다');
  it.todo(
    'DB-08 발송 가능한 긴급 Delivery와 대량 Delivery가 함께 대기 중 / 워커가 claim한다 → 긴급 Delivery가 먼저 나오고, RETRY_WAIT(재시도 시각 전) 긴급 Delivery는 대량 Delivery의 claim을 막지 않는다',
  );
  it.todo(
    'DB-09 lease가 만료된 IN_FLIGHT Delivery / 복구 쿼리 → UNKNOWN으로 바뀌고 reconcile 가능 시각이 기록된다',
  );
  it.todo('DB-10 다른 leaseToken으로 결과 저장 / 갱신 쿼리 → 0행이 갱신되고 기존 상태가 유지된다');
});
