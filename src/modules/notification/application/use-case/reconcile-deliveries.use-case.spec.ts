import { describe, it } from 'vitest';

describe('ReconcileDeliveriesUseCase', () => {
  it.todo(
    'UC-14 reconcile 가능 시각이 지난 UNKNOWN Delivery 여러 건 / reconcile 유스케이스 → 건마다 발송 내역을 조회해 DLV-09~13, DLV-19, DLV-21 규칙대로 확정한다',
  );
  it.todo(
    'UC-15 외부 발송이 성공한 직후 결과 저장 전에 워커가 멈췄다 / lease 만료 후 복구와 reconcile을 실행한다 → 재전송 없이 SENT로 확정된다',
  );
});
