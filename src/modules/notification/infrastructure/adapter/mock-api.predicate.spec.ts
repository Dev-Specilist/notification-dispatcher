import { describe, expect, it } from 'vitest';
import { MockApiPredicates } from '@/modules/notification/infrastructure/adapter/mock-api.predicate';

type TimeoutCase = Readonly<[string, number]>;

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
});
