import { describe, it } from 'vitest';

describe('CancelAlarmUseCase', () => {
  it.todo('UC-02 없는 알림 id / 조회·발송 시작·취소 → 알림 없음 오류가 난다');
  it.todo(
    'UC-13 취소된 알림의 대기 Delivery / 취소 유스케이스 → 대기 Delivery가 한 번에 CANCELLED가 되고 처리 중인 건은 결과 확정 후 정리된다',
  );
});
