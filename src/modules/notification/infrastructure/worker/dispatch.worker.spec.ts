import { describe, it } from 'vitest';

describe('DispatchWorker', () => {
  it.todo(
    'WRK-01 워커 모듈 / 애플리케이션 부트스트랩이 끝난다 → 확장 · 발송 · reconcile · lease 복구 루프가 시작된다',
  );
  it.todo('WRK-02 실행 중인 워커 / 종료 신호를 받는다 → 새 claim을 즉시 멈추고 readiness를 내린다');
  it.todo(
    'WRK-03 진행 중인 요청이 있는 워커 / 종료 절차가 진행된다 → 진행 중 요청의 결과를 제한 시간 안에 저장한 뒤 DB 연결을 닫는다',
  );
  it.todo(
    'WRK-04 제한 시간 안에 끝나지 않는 요청 / 종료 절차가 진행된다 → 요청을 중단하고 lease를 남겨 둔 채 종료하며, 남은 건은 lease 만료 후 다른 워커가 reconcile한다',
  );
});
