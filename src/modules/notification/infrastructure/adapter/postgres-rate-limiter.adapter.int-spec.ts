import { describe, it } from 'vitest';

describe('PostgresRateLimiter', () => {
  it.todo(
    'DB-11 초당 50건 제한기 (초기 상태 포함) / 워커 여러 개가 경계 시각 전후로 토큰을 요청한다 → 임의의 1초 구간에서 발급된 토큰 합이 50을 넘지 않는다',
  );
  it.todo('DB-12 제한기가 Retry-After로 정지됐다 / 정지 시각 전에 토큰을 요청한다 → 0개를 받는다');
  it.todo(
    'DB-13 정지 중인 제한기 / 더 짧은 Retry-After가 들어온다 → 정지 시각이 앞당겨지지 않는다',
  );
});
