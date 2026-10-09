import { describe, expect, it } from 'vitest';
import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import {
  AlarmCreation,
  AlarmId,
  AlarmKind,
  AlarmStatus,
  AlarmTransition,
  RecipientId,
} from '@/modules/notification/domain/alarm/alarm.type';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import { DeliveryId } from '@/modules/notification/domain/delivery/delivery.type';
import { AlarmLookup } from '@/modules/notification/application/port/out/alarm-repository.type';
import { ClockPort } from '@/modules/notification/application/port/out/clock.port';
import { TransactionPort } from '@/modules/notification/application/port/out/transaction.port';
import { SettledAlarmsSwept } from '@/modules/notification/application/port/in/complete-settled-alarms.type';
import { CompleteAlarmIfSettledService } from '@/modules/notification/application/service/complete-alarm-if-settled.service';
import { CompleteSettledAlarmsService } from '@/modules/notification/application/service/complete-settled-alarms.service';
import { InMemoryAlarmRepositoryAdapter } from '@/modules/notification/adapter/out/in-memory/in-memory-alarm-repository.adapter';
import { InMemoryDeliveryRepositoryAdapter } from '@/modules/notification/adapter/out/in-memory/in-memory-delivery-repository.adapter';
import { InMemoryExpansionJobRepositoryAdapter } from '@/modules/notification/adapter/out/in-memory/in-memory-expansion-job-repository.adapter';
import { InMemoryTransactionAdapter } from '@/modules/notification/adapter/out/in-memory/in-memory-transaction.adapter';

interface Fixture {
  readonly alarmRepository: InMemoryAlarmRepositoryAdapter;
  readonly deliveryRepository: InMemoryDeliveryRepositoryAdapter;
  readonly expansionJobRepository: InMemoryExpansionJobRepositoryAdapter;
  readonly service: CompleteSettledAlarmsService;
}

const CREATED_ISO: string = '2026-10-08T09:00:00.000Z';
const DISPATCHED_ISO: string = '2026-10-08T09:01:00.000Z';
const NOW_ISO: string = '2026-10-08T09:30:00.000Z';
const MORE_THAN_ONE_PAGE: number = 101;

const at = (iso: string): Date => new Date(iso);

const alarmIdAt = (index: number): AlarmId => {
  const rawAlarmId: string = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  if (!AlarmPredicates.isAlarmId(rawAlarmId)) {
    throw new Error(`test fixture ${rawAlarmId} is not a valid AlarmId`);
  }
  return rawAlarmId;
};

const recipientId = (): RecipientId => {
  const rawRecipientId: string = 'u_000001';
  if (!AlarmPredicates.isRecipientId(rawRecipientId)) {
    throw new Error(`test fixture ${rawRecipientId} is not a valid RecipientId`);
  }
  return rawRecipientId;
};

const deliveryId = (): DeliveryId => {
  const rawDeliveryId: string = '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7caa';
  if (!DeliveryPredicates.isDeliveryId(rawDeliveryId)) {
    throw new Error(`test fixture ${rawDeliveryId} is not a valid DeliveryId`);
  }
  return rawDeliveryId;
};

const draftAlarm = (alarmId: AlarmId, kind: AlarmKind): Alarm => {
  const creation: AlarmCreation = Alarm.create(
    alarmId,
    {
      title: '서버 점검',
      body: '10분 뒤 점검',
      kind,
      recipientIds: kind === 'URGENT' ? ['u_000001'] : [],
    },
    at(CREATED_ISO),
  );
  if (creation.kind !== 'created') {
    throw new Error(`test fixture alarm is invalid: ${creation.error.code}`);
  }
  return creation.alarm;
};

const dispatched = (alarm: Alarm): Alarm => {
  const transition: AlarmTransition = alarm.startDispatch(at(DISPATCHED_ISO));
  if (transition.kind !== 'transitioned') {
    throw new Error(`test fixture alarm cannot be dispatched: ${transition.error.code}`);
  }
  return transition.alarm;
};

const pendingDelivery = (alarmId: AlarmId): Delivery =>
  Delivery.create(
    { id: deliveryId(), alarmId, recipientId: recipientId(), priority: 'URGENT' },
    at(DISPATCHED_ISO),
  );

class FixedClock implements ClockPort {
  now(): Date {
    return at(NOW_ISO);
  }
}

const fixture = (): Fixture => {
  const alarmRepository: InMemoryAlarmRepositoryAdapter = new InMemoryAlarmRepositoryAdapter();
  const deliveryRepository: InMemoryDeliveryRepositoryAdapter =
    new InMemoryDeliveryRepositoryAdapter();
  const expansionJobRepository: InMemoryExpansionJobRepositoryAdapter =
    new InMemoryExpansionJobRepositoryAdapter();
  const transaction: TransactionPort = new InMemoryTransactionAdapter({
    alarmRepository,
    deliveryRepository,
    expansionJobRepository,
  });
  return {
    alarmRepository,
    deliveryRepository,
    expansionJobRepository,
    service: new CompleteSettledAlarmsService(
      transaction,
      new CompleteAlarmIfSettledService(transaction, new FixedClock()),
    ),
  };
};

const storedStatus = async (
  alarmRepository: InMemoryAlarmRepositoryAdapter,
  alarmId: AlarmId,
): Promise<AlarmStatus> => {
  const lookup: AlarmLookup = await alarmRepository.findById(alarmId);
  if (lookup.kind !== 'found') {
    throw new Error(`expected alarm ${alarmId} to be stored`);
  }
  return lookup.alarm.snapshot().state.status;
};

describe('CompleteSettledAlarmsService', () => {
  it('UC-19 발송 중인 알림 여러 개 / 완료 확인 유스케이스 → 발송 중인 알림을 모두 확인해 확장이 끝나고 미종결 Delivery가 없는 알림만 COMPLETED로 바꾼다', async (): Promise<void> => {
    const { alarmRepository, deliveryRepository, expansionJobRepository, service }: Fixture =
      fixture();
    const settledAlarmIds: Array<AlarmId> = [];
    for (let index: number = 1; index <= MORE_THAN_ONE_PAGE; index += 1) {
      settledAlarmIds.push(alarmIdAt(index));
      await alarmRepository.save(dispatched(draftAlarm(alarmIdAt(index), 'URGENT')));
    }
    const unsettledAlarmId: AlarmId = alarmIdAt(MORE_THAN_ONE_PAGE + 1);
    await alarmRepository.save(dispatched(draftAlarm(unsettledAlarmId, 'URGENT')));
    await deliveryRepository.saveAll([pendingDelivery(unsettledAlarmId)]);
    const expandingAlarmId: AlarmId = alarmIdAt(MORE_THAN_ONE_PAGE + 2);
    await alarmRepository.save(dispatched(draftAlarm(expandingAlarmId, 'BULK')));
    await expansionJobRepository.enqueue(expandingAlarmId, at(DISPATCHED_ISO));
    const draftAlarmId: AlarmId = alarmIdAt(MORE_THAN_ONE_PAGE + 3);
    await alarmRepository.save(draftAlarm(draftAlarmId, 'URGENT'));

    const sweep: SettledAlarmsSwept = await service.execute();

    expect(sweep).toEqual({
      kind: 'swept',
      checkedAlarmCount: MORE_THAN_ONE_PAGE + 2,
      completedAlarmCount: MORE_THAN_ONE_PAGE,
    });
    for (const settledAlarmId of settledAlarmIds) {
      expect(await storedStatus(alarmRepository, settledAlarmId)).toBe('COMPLETED');
    }
    expect(await storedStatus(alarmRepository, unsettledAlarmId)).toBe('DISPATCHING');
    expect(await storedStatus(alarmRepository, expandingAlarmId)).toBe('DISPATCHING');
    expect(await storedStatus(alarmRepository, draftAlarmId)).toBe('DRAFT');
  });

  it('UC-19 발송 중인 알림이 없으면 아무것도 바꾸지 않는다', async (): Promise<void> => {
    const { service }: Fixture = fixture();

    expect(await service.execute()).toEqual({
      kind: 'swept',
      checkedAlarmCount: 0,
      completedAlarmCount: 0,
    });
  });
});
