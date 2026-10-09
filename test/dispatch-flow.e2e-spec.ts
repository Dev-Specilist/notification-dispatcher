import { describe, it } from 'vitest';

describe('발송 전체 흐름', () => {
  it.todo(
    'E2E-01 USER_COUNT를 줄이고 일시 오류·타임아웃을 끈 mock, 워커 1개 / 대량 알림을 만들고 발송을 시작한다 → 수신 거부가 아닌 사용자는 mock 발송 내역 기준 정확히 1회, 수신 거부 사용자는 0회 발송되어 FAILED가 되고, 알림이 COMPLETED가 된다',
  );
  it.todo(
    'E2E-02 오류·타임아웃 비율을 높인 mock / 대량 알림 발송 → 일시 오류는 재시도되고, 타임아웃 건은 reconcile로 확정되어 같은 clientRef 내역이 2건 이상인 Delivery가 없다',
  );
  it.todo(
    'E2E-03 대량 알림 발송 중 / 긴급 알림이 발송 가능해진다 → 발송 가능한 긴급 Delivery가 남아 있는 동안 발송 허가를 얻은 요청은 모두 긴급 Delivery를 보낸다 (이미 시작된 대량 요청은 제외)',
  );
  it.todo('E2E-04 워커 3개 / 대량 알림 발송 → 429가 지속되지 않고 중복·누락 없이 끝난다');
  it.todo(
    'E2E-05 워커 3개로 발송 중 / 워커 하나를 강제로 멈춘다 → 남은 워커가 lease 만료분까지 이어받아 중복·누락 없이 끝난다',
  );
  it.todo(
    'E2E-06 대량 알림 발송 중 / 알림을 취소한다 → 새 발송이 멈추고, 이미 나간 건은 SENT로 남으며 나머지는 CANCELLED가 된다',
  );
});
