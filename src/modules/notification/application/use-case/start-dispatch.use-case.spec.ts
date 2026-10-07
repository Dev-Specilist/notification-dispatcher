import { describe, it } from 'vitest';

describe('StartDispatchUseCase', () => {
  it.todo('UC-02 없는 알림 id / 조회·발송 시작·취소 → 알림 없음 오류가 난다');
  it.todo(
    'UC-03 긴급 DRAFT 알림 / 발송 시작 → 같은 트랜잭션에서 상태 변경과 수신자별 Delivery 생성이 함께 커밋된다',
  );
  it.todo(
    'UC-04 대량 DRAFT 알림 / 발송 시작 → 같은 트랜잭션에서 상태 변경과 확장 작업 생성이 함께 커밋된다',
  );
  it.todo('UC-05 발송 시작 중 / 작업 생성이 실패한다 → 전체가 롤백되어 알림은 DRAFT로 남는다');
});
