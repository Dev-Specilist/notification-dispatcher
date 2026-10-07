import { describe, it } from 'vitest';

describe('DrizzleAlarmRepository', () => {
  it.todo('DB-01 알림 저장소 / 저장 후 id로 조회한다 → 같은 도메인 객체로 복원된다');
  it.todo(
    'DB-02 알림 여러 개 / 상태·종류 필터와 cursor로 목록을 조회한다 → 생성 역순으로 페이지가 나뉘고 다음 cursor가 반환된다',
  );
  it.todo(
    'DB-03 생성 시각이 같은 알림 여러 개 / cursor로 끝까지 조회한다 → (생성 시각, id) 복합 cursor로 누락·중복 없이 이어진다',
  );
  it.todo(
    'DB-04 같은 DRAFT 알림 / 발송 시작 요청 두 개가 동시에 들어온다 → 하나만 성공하고 나머지는 상태 충돌이 난다',
  );
  it.todo(
    'DB-05 DRAFT 알림 / 발송 시작과 취소가 동시에 들어온다 → 최종 상태와 각 요청의 성공·실패가 어떤 직렬 실행 순서의 결과와 일치한다',
  );
});
