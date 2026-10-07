import { describe, expect, it } from 'vitest';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import { AttemptLimit, JitterRatio } from '@/modules/notification/domain/delivery/delivery.type';
import { RetryPolicy } from '@/modules/notification/domain/delivery/retry-policy';
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

const policy = (): RetryPolicy =>
  new RetryPolicy({
    maxAttempts: attemptLimit(5),
    baseDelayMs: durationMs(1_000),
    maxDelayMs: durationMs(8_000),
  });

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
