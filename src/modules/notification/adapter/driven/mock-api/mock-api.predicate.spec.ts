import { describe, expect, it } from 'vitest';
import { MockApiPredicates } from '@/modules/notification/adapter/driven/mock-api/mock-api.predicate';

type TimeoutCase = Readonly<[string, number]>;

type LimitCase = Readonly<[string, number]>;

describe('MockApiPredicates', () => {
  it.each<TimeoutCase>([
    ['1ms', 1],
    ['10초', 10_000],
    ['Node 타이머 상한', 2_147_483_647],
  ])('요청 제한 시간은 %s(%s)를 허용한다', (_label: string, value: number): void => {
    expect(MockApiPredicates.isRequestTimeoutMs(value)).toBe(true);
  });

  it.each<TimeoutCase>([
    ['0', 0],
    ['음수', -1],
    ['소수', 1.5],
    ['Node 타이머 상한 초과', 2_147_483_648],
    ['NaN', Number.NaN],
  ])(
    '요청 제한 시간은 %s(%s)를 허용하지 않는다 (Node 타이머가 1ms로 바꿔 즉시 타임아웃되므로)',
    (_label: string, value: number): void => {
      expect(MockApiPredicates.isRequestTimeoutMs(value)).toBe(false);
    },
  );

  it.each<LimitCase>([
    ['최소', 1],
    ['기본', 100],
    ['최대', 1_000],
  ])('사용자 페이지 크기는 %s(%s)를 허용한다', (_label: string, value: number): void => {
    expect(MockApiPredicates.isUserPageLimit(value)).toBe(true);
  });

  it.each<LimitCase>([
    ['0', 0],
    ['최대 초과', 1_001],
    ['소수', 1.5],
    ['NaN', Number.NaN],
  ])(
    '사용자 페이지 크기는 %s(%s)를 허용하지 않는다 (mock API 제약 1~1000)',
    (_label: string, value: number): void => {
      expect(MockApiPredicates.isUserPageLimit(value)).toBe(false);
    },
  );
});
