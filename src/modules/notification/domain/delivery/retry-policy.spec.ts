import { describe, expect, expectTypeOf, it } from 'vitest';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import { AttemptLimit, JitterRatio } from '@/modules/notification/domain/delivery/delivery.type';
import { RetryPolicy } from '@/modules/notification/domain/delivery/retry-policy';
import {
  RetryPolicyCreation,
  RetryPolicyOptions,
} from '@/modules/notification/domain/delivery/retry-policy.type';
import { DurationPredicates } from '@/shared/domain/duration.predicate';
import { DurationMs } from '@/shared/domain/duration.type';

type DelayCase = Readonly<[number, number, number]>;

type InvalidRatioCase = Readonly<[string, number]>;

const durationMs = (value: number): DurationMs => {
  if (!DurationPredicates.isDurationMs(value)) {
    throw new Error(`test fixture ${value} is not a valid DurationMs`);
  }
  return value;
};

const attemptLimit = (value: number): AttemptLimit => {
  if (!DeliveryPredicates.isAttemptLimit(value)) {
    throw new Error(`test fixture ${value} is not a valid AttemptLimit`);
  }
  return value;
};

const jitter = (value: number): JitterRatio => {
  if (!DeliveryPredicates.isJitterRatio(value)) {
    throw new Error(`test fixture ${value} is not a valid JitterRatio`);
  }
  return value;
};

const options = (baseMs: number, maxMs: number): RetryPolicyOptions => ({
  maxAttempts: attemptLimit(5),
  baseDelayMs: durationMs(baseMs),
  maxDelayMs: durationMs(maxMs),
});

const created = (creation: RetryPolicyCreation): RetryPolicy => {
  if (creation.kind !== 'created') {
    throw new Error(`expected created but got ${creation.error.code}`);
  }
  return creation.policy;
};

const policy = (): RetryPolicy => created(RetryPolicy.create(options(1_000, 8_000)));

describe('RetryPolicy', () => {
  it.each<DelayCase>([
    [1, 0, 500],
    [1, 0.999, 999],
    [2, 0, 1_000],
    [3, 0.5, 3_000],
    [4, 0, 4_000],
    [5, 0, 4_000],
    [9, 0.999, 7_996],
  ])(
    'DLV-05 시도 %s회 후 jitter %s → 지수 백오프 지연은 %sms다 (최대 지연에서 멈추고 절반은 고정)',
    (attempts: number, ratio: number, expectedMs: number) => {
      expect(policy().delayFor(attempts, jitter(ratio))).toBe(expectedMs);
    },
  );

  it('기본 지연이 최대 지연보다 크면 정책을 만들 수 없다', () => {
    expect(RetryPolicy.create(options(9_000, 8_000))).toEqual({
      kind: 'rejected',
      error: { code: 'BASE_DELAY_EXCEEDS_MAX', baseDelayMs: 9_000, maxDelayMs: 8_000 },
    });
  });

  it('기본 지연과 최대 지연이 같으면 정책을 만들 수 있다', () => {
    expect(RetryPolicy.create(options(8_000, 8_000)).kind).toBe('created');
  });

  it('정책을 만든 뒤 넘긴 옵션 객체가 바뀌어도 정책은 바뀌지 않는다', () => {
    const given: RetryPolicyOptions = options(1_000, 8_000);
    const retryPolicy: RetryPolicy = created(RetryPolicy.create(given));

    Object.assign(given, { baseDelayMs: durationMs(4_000) });

    expect(retryPolicy.delayFor(1, jitter(0))).toBe(500);
  });

  it('지연 계산 결과의 타입은 검증된 시간 값(DurationMs)이다', () => {
    expectTypeOf(policy().delayFor(1, jitter(0))).toEqualTypeOf<DurationMs>();
  });

  it('DLV-05 계산된 지연은 항상 유효한 시간 값이다', () => {
    const delayMs: number = policy().delayFor(1, jitter(0));

    expect(DurationPredicates.isDurationMs(delayMs)).toBe(true);
  });

  it('DLV-06 최대 시도 횟수에 도달하면 재시도 횟수를 다 쓴 것으로 본다', () => {
    expect(policy().isExhausted(4)).toBe(false);
    expect(policy().isExhausted(5)).toBe(true);
  });

  it.each<InvalidRatioCase>([
    ['음수', -0.1],
    ['1', 1],
    ['NaN', Number.NaN],
  ])('jitter 비율은 %s(%s)을 허용하지 않는다 (0 이상 1 미만)', (_label: string, value: number) => {
    expect(DeliveryPredicates.isJitterRatio(value)).toBe(false);
  });

  it.each<InvalidRatioCase>([
    ['0', 0],
    ['소수', 1.5],
    ['음수', -1],
  ])('최대 시도 횟수는 %s(%s)을 허용하지 않는다 (1 이상 정수)', (_label: string, value: number) => {
    expect(DeliveryPredicates.isAttemptLimit(value)).toBe(false);
  });
});
