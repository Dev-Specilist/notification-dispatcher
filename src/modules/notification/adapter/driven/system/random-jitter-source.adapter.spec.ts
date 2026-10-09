import { describe, expect, it } from 'vitest';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import { RandomJitterSourceAdapter } from '@/modules/notification/adapter/driven/system/random-jitter-source.adapter';

const SAMPLE_SIZE: number = 1000;

describe('RandomJitterSourceAdapter', () => {
  it('지터 비율은 0 이상 1 미만이고 매번 같은 값이 아니다', (): void => {
    const jitterSource: RandomJitterSourceAdapter = new RandomJitterSourceAdapter();

    const jitterRatios: ReadonlyArray<number> = Array.from({ length: SAMPLE_SIZE }, (): number =>
      jitterSource.next(),
    );

    expect(
      jitterRatios.every((jitterRatio: number): boolean =>
        DeliveryPredicates.isJitterRatio(jitterRatio),
      ),
    ).toBe(true);
    expect(new Set(jitterRatios).size).toBeGreaterThan(1);
  });
});
