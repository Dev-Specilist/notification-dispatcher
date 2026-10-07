import { describe, it } from 'vitest';

describe('Delivery', () => {
  it.todo(
    'DLV-01 PENDING Delivery / 워커가 claim한다 → IN_FLIGHT가 되고 새 leaseToken과 lease 만료 시각이 기록된다. 시도 횟수는 아직 늘지 않는다',
  );
  it.todo(
    'DLV-02 IN_FLIGHT Delivery / 실제 HTTP 요청을 시작한다 → 시도 횟수가 1 늘고 요청 시작 시각이 기록된다',
  );
  it.todo('DLV-03 IN_FLIGHT Delivery / 202 응답을 받는다 → SENT가 되고 messageId가 기록된다');
  it.todo(
    'DLV-04 IN_FLIGHT Delivery / 400 RECIPIENT_BLOCKED·UNKNOWN_RECIPIENT·INVALID_REQUEST를 받는다 → 재시도 없이 FAILED가 되고 사유 코드가 기록된다',
  );
  it.todo(
    'DLV-07 IN_FLIGHT Delivery / 429와 Retry-After: n을 받는다 → RETRY_WAIT가 되고 n초 뒤로 미뤄지며 시도 횟수는 되돌린다',
  );
  it.todo(
    'DLV-08 IN_FLIGHT Delivery / 응답 타임아웃·연결 오류가 난다 → 재전송하지 않고 UNKNOWN이 되며 reconcile 가능 시각(요청 시작 + RECONCILE_DELAY_MS)이 기록된다',
  );
  it.todo(
    'DLV-09 UNKNOWN Delivery / reconcile에서 같은 clientRef의 발송 내역 1건을 찾는다 → SENT가 되고 messageId가 기록된다',
  );
  it.todo(
    'DLV-10 reconcile 가능 시각이 지난 UNKNOWN Delivery / reconcile에서 발송 내역이 없다 → 최대 시도 횟수 안이면 RETRY_WAIT, 소진했으면 FAILED(RETRY_EXHAUSTED)가 된다',
  );
  it.todo(
    'DLV-11 reconcile 가능 시각 전의 UNKNOWN Delivery / reconcile 대상을 고른다 → 대상에서 빠진다 (이전 요청이 아직 진행 중일 수 있음)',
  );
  it.todo(
    'DLV-12 UNKNOWN Delivery / 발송 내역 조회 자체가 실패한다 → 빈 내역으로 보지 않고 UNKNOWN을 유지하며 백오프 후 다음 조회를 예약한다',
  );
  it.todo(
    'DLV-13 UNKNOWN Delivery / 같은 clientRef의 발송 내역이 2건 이상 나온다 → SENT가 되고 중복 발송 건수가 기록된다',
  );
  it.todo(
    'DLV-14 lease가 만료된 IN_FLIGHT Delivery (워커 종료) / 복구를 실행한다 → 재전송하지 않고 UNKNOWN으로 넘기며 reconcile 가능 시각(lease 만료 + RECONCILE_DELAY_MS)을 기록한다',
  );
  it.todo(
    'DLV-15 leaseToken이 바뀐 Delivery (다른 워커가 이어받음) / 이전 워커가 결과를 저장한다 → 저장이 거부된다',
  );
  it.todo(
    'DLV-16 남은 lease 시간이 HTTP 최대 실행 시간보다 짧은 IN_FLIGHT Delivery / 요청을 시작하려 한다 → 요청을 시작하지 않고 lease를 반납한다',
  );
  it.todo('DLV-17 PENDING·RETRY_WAIT Delivery / 알림이 취소된다 → CANCELLED가 된다');
  it.todo(
    'DLV-18 알림이 취소된 뒤의 IN_FLIGHT Delivery / 늦게 202를 받는다 → 이미 나간 사실대로 SENT가 된다',
  );
  it.todo(
    'DLV-19 UNKNOWN Delivery이고 알림이 취소됐다 / reconcile에서 발송 내역이 없다 → 재시도 대신 CANCELLED가 된다',
  );
  it.todo(
    'DLV-20 SENT·FAILED·CANCELLED·UNCONFIRMED Delivery / 어떤 결과든 다시 기록하려 한다 → 종결 상태는 바뀌지 않는다',
  );
  it.todo(
    'DLV-21 확인 기간(UNCONFIRMED_AFTER_MS)이 지난 UNKNOWN Delivery / reconcile 대상을 고른다 → 재전송하지 않고 UNCONFIRMED로 종결된다',
  );
});
