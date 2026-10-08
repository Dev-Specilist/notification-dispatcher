import { describe, expect, it } from 'vitest';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import { RandomIdGeneratorAdapter } from '@/modules/notification/adapter/out/system/random-id-generator.adapter';

const SAMPLE_SIZE: number = 100;

describe('RandomIdGeneratorAdapter', () => {
  const generator: RandomIdGeneratorAdapter = new RandomIdGeneratorAdapter();

  it('알림 id는 도메인 형식(UUID)을 지키고 매번 다르다', (): void => {
    const ids: ReadonlyArray<string> = Array.from({ length: SAMPLE_SIZE }, (): string =>
      generator.alarmId(),
    );

    expect(ids.every((id: string): boolean => AlarmPredicates.isAlarmId(id))).toBe(true);
    expect(new Set(ids).size).toBe(SAMPLE_SIZE);
  });

  it('Delivery id는 도메인 형식(UUID)을 지키고 매번 다르다', (): void => {
    const ids: ReadonlyArray<string> = Array.from({ length: SAMPLE_SIZE }, (): string =>
      generator.deliveryId(),
    );

    expect(ids.every((id: string): boolean => DeliveryPredicates.isDeliveryId(id))).toBe(true);
    expect(new Set(ids).size).toBe(SAMPLE_SIZE);
  });
});
