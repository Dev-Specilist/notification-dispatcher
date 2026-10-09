import { describe, expect, it } from 'vitest';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import { DeliveryRepositoryContract } from '@/modules/notification/testing/contract/delivery-repository.contract';
import { InMemoryAlarmRepositoryAdapter } from '@/modules/notification/testing/in-memory/in-memory-alarm-repository.adapter';
import { InMemoryDeliveryRepositoryAdapter } from '@/modules/notification/testing/in-memory/in-memory-delivery-repository.adapter';
import { Rollback } from '@/modules/notification/testing/in-memory/rollback.type';

const ENQUEUED_ISO: string = '2026-10-07T09:05:00.000Z';
const ALARM_ID: string = '0b6c1b4e-9a37-4c2a-8d6a-2f6b2d7f1a10';

const alarmId = (rawAlarmId: string): AlarmId => {
  if (!AlarmPredicates.isAlarmId(rawAlarmId)) {
    throw new Error(`test fixture ${rawAlarmId} is not a valid AlarmId`);
  }
  return rawAlarmId;
};

const pendingDelivery = (deliveryNumber: number, rawRecipientId: string): Delivery => {
  const rawDeliveryId: string = `00000000-0000-4000-8000-${String(deliveryNumber).padStart(12, '0')}`;
  if (!DeliveryPredicates.isDeliveryId(rawDeliveryId)) {
    throw new Error(`test fixture ${rawDeliveryId} is not a valid DeliveryId`);
  }
  if (!AlarmPredicates.isRecipientId(rawRecipientId)) {
    throw new Error(`test fixture ${rawRecipientId} is not a valid RecipientId`);
  }
  return Delivery.create(
    {
      id: rawDeliveryId,
      alarmId: alarmId(ALARM_ID),
      recipientId: rawRecipientId,
      priority: 'BULK',
    },
    new Date(ENQUEUED_ISO),
  );
};

describe('InMemoryDeliveryRepositoryAdapter', () => {
  DeliveryRepositoryContract.verify(() =>
    Promise.resolve({
      alarmRepository: new InMemoryAlarmRepositoryAdapter(),
      deliveryRepository: new InMemoryDeliveryRepositoryAdapter(),
    }),
  );

  it('롤백하면 수신자 색인도 되돌아가 같은 수신자를 다시 저장할 수 있다', async (): Promise<void> => {
    const repository: InMemoryDeliveryRepositoryAdapter = new InMemoryDeliveryRepositoryAdapter();
    const rollback: Rollback = repository.checkpoint();
    await repository.insertMissing([pendingDelivery(1, 'u_000001')]);

    rollback();
    await repository.insertMissing([pendingDelivery(2, 'u_000001')]);

    expect(
      (await repository.findByAlarmId(alarmId(ALARM_ID))).map(
        (delivery: Delivery): string => delivery.snapshot().id,
      ),
    ).toEqual(['00000000-0000-4000-8000-000000000002']);
  });
});
