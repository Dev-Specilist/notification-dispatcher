import { describe, it } from 'vitest';

describe('Alarm', () => {
  it.todo(
    'ALM-01 제목과 본문이 있는 대량 알림 요청 / 알림을 만든다 → DRAFT 상태이고 수신자 목록은 비어 있다',
  );
  it.todo('ALM-02 제목이나 본문이 비어 있다 / 알림을 만든다 → 생성이 거부된다');
  it.todo(
    'ALM-03 수신자 1~100명을 지정한 긴급 알림 요청 / 알림을 만든다 → DRAFT 상태이고 지정한 수신자를 중복 없이 가진다',
  );
  it.todo(
    'ALM-04 수신자가 0명이거나 100명을 넘는 긴급 알림 요청 / 알림을 만든다 → 생성이 거부된다',
  );
  it.todo(
    'ALM-05 대량 알림에 수신자를 지정했다 / 알림을 만든다 → 생성이 거부된다 (대량 알림은 전체 사용자 대상)',
  );
  it.todo('ALM-06 DRAFT 알림 / 발송을 시작한다 → DISPATCHING이 되고 시작 시각이 기록된다');
  it.todo(
    'ALM-07 DISPATCHING·COMPLETED·CANCELLED 알림 / 발송을 시작한다 → 상태 충돌로 거부되고 상태는 바뀌지 않는다',
  );
  it.todo('ALM-08 DRAFT 또는 DISPATCHING 알림 / 취소한다 → CANCELLED가 되고 취소 시각이 기록된다');
  it.todo('ALM-09 COMPLETED·CANCELLED 알림 / 취소한다 → 상태 충돌로 거부된다');
  it.todo(
    'ALM-10 DISPATCHING 알림 / 확장 완료이고 미종결 Delivery가 0건이라는 판정 근거를 받는다 → COMPLETED가 된다',
  );
  it.todo(
    'ALM-11 DISPATCHING 알림 / 확장 미완료이거나 미종결 Delivery가 남아 있다는 판정 근거를 받는다 → DISPATCHING을 유지한다',
  );
});
