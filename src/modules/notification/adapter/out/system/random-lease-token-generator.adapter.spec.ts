import { describe, expect, it } from 'vitest';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import { RandomLeaseTokenGeneratorAdapter } from '@/modules/notification/adapter/out/system/random-lease-token-generator.adapter';

const SAMPLE_SIZE: number = 100;

describe('RandomLeaseTokenGeneratorAdapter', () => {
  it('lease token은 도메인 형식(UUID)을 지키고 claim마다 다르다', (): void => {
    const generator: RandomLeaseTokenGeneratorAdapter = new RandomLeaseTokenGeneratorAdapter();

    const leaseTokens: ReadonlyArray<string> = Array.from({ length: SAMPLE_SIZE }, (): string =>
      generator.next(),
    );

    expect(
      leaseTokens.every((leaseToken: string): boolean =>
        DeliveryPredicates.isLeaseToken(leaseToken),
      ),
    ).toBe(true);
    expect(new Set(leaseTokens).size).toBe(SAMPLE_SIZE);
  });
});
