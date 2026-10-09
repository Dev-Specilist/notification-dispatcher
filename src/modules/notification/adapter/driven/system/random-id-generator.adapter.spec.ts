import { describe, expect, it } from 'vitest';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import { RandomIdGeneratorAdapter } from '@/modules/notification/adapter/driven/system/random-id-generator.adapter';

const SAMPLE_SIZE: number = 100;

describe('RandomIdGeneratorAdapter', () => {
  const generator: RandomIdGeneratorAdapter = new RandomIdGeneratorAdapter();

  it('알림 id는 도메인 형식(UUID)을 지키고 매번 다르다', (): void => {
    const alarmIds: ReadonlyArray<string> = Array.from({ length: SAMPLE_SIZE }, (): string =>
      generator.alarmId(),
    );

    expect(alarmIds.every((alarmId: string): boolean => AlarmPredicates.isAlarmId(alarmId))).toBe(
      true,
    );
    expect(new Set(alarmIds).size).toBe(SAMPLE_SIZE);
  });

  it('Delivery id는 도메인 형식(UUID)을 지키고 매번 다르다', (): void => {
    const deliveryIds: ReadonlyArray<string> = Array.from({ length: SAMPLE_SIZE }, (): string =>
      generator.deliveryId(),
    );

    expect(
      deliveryIds.every((deliveryId: string): boolean =>
        DeliveryPredicates.isDeliveryId(deliveryId),
      ),
    ).toBe(true);
    expect(new Set(deliveryIds).size).toBe(SAMPLE_SIZE);
  });
});
