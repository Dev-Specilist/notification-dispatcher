import { describe, it } from 'vitest';

describe('ExpandRecipientsUseCase', () => {
  it.todo(
    'UC-06 확장 대기 중인 대량 알림 / 확장 유스케이스가 사용자 API를 cursor 끝까지 읽는다 → 페이지마다 Delivery 생성과 cursor 저장이 한 트랜잭션으로 커밋된다',
  );
  it.todo(
    'UC-07 확장 도중 워커가 멈췄다 / 다른 워커가 확장을 이어받는다 → 저장된 cursor부터 이어서 읽고 같은 수신자의 Delivery는 중복 생성되지 않는다',
  );
  it.todo(
    'UC-08 확장 중 알림이 취소됐다 / 다음 페이지를 처리한다 → 확장을 멈추고 더 이상 Delivery를 만들지 않는다',
  );
});
