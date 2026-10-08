import { describe, expect, it } from 'vitest';
import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import {
  AlarmCreation,
  AlarmDraft,
  AlarmId,
  AlarmState,
  AlarmTransition,
  RecipientId,
} from '@/modules/notification/domain/alarm/alarm.type';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import {
  DeliveryId,
  DeliveryPriority,
  DeliveryTransition,
  LeaseToken,
  MessageId,
} from '@/modules/notification/domain/delivery/delivery.type';
import { DurationPredicates } from '@/shared/domain/duration.predicate';
import { DurationMs } from '@/shared/domain/duration.type';
import { AlarmLookup } from '@/modules/notification/application/port/out/alarm-repository.type';
import { ClockPort } from '@/modules/notification/application/port/out/clock.port';
import { CompleteAlarmResult } from '@/modules/notification/application/port/in/alarm-result.type';
import { CompleteAlarmIfSettledService } from '@/modules/notification/application/service/complete-alarm-if-settled.service';
import { InMemoryAlarmRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-alarm-repository.adapter';
import { InMemoryDeliveryRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-delivery-repository.adapter';
import { InMemoryExpansionJobRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-expansion-job-repository.adapter';
import { InMemoryUnitOfWorkAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-unit-of-work.adapter';

type DeliveryBuilder = (index: number) => Delivery;

interface Fixture {
  readonly alarmRepository: InMemoryAlarmRepositoryAdapter;
  readonly expansionJobRepository: InMemoryExpansionJobRepositoryAdapter;
  readonly service: CompleteAlarmIfSettledService;
}

const CREATED_ISO: string = '2026-10-08T09:00:00.000Z';
const DISPATCHED_ISO: string = '2026-10-08T09:01:00.000Z';
const SETTLED_ISO: string = '2026-10-08T09:02:00.000Z';
const NOW_ISO: string = '2026-10-08T09:30:00.000Z';
const ALARM_ID: string = '0b6c1b4e-9a37-4c2a-8d6a-2f6b2d7f1a10';
const MISSING_ALARM_ID: string = '7d3f1e2a-4b5c-4d6e-8f70-1a2b3c4d5e6f';
const LEASE_TOKEN: string = '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7caa';

const at = (iso: string): Date => new Date(iso);

const alarmId = (value: string): AlarmId => {
  if (!AlarmPredicates.isAlarmId(value)) {
    throw new Error(`test fixture ${value} is not a valid AlarmId`);
  }
  return value;
};

const recipientId = (index: number): RecipientId => {
  const value: string = `u_${String(index).padStart(6, '0')}`;
  if (!AlarmPredicates.isRecipientId(value)) {
    throw new Error(`test fixture ${value} is not a valid RecipientId`);
  }
  return value;
};

const deliveryId = (index: number): DeliveryId => {
  const value: string = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  if (!DeliveryPredicates.isDeliveryId(value)) {
    throw new Error(`test fixture ${value} is not a valid DeliveryId`);
  }
  return value;
};

const leaseToken = (): LeaseToken => {
  if (!DeliveryPredicates.isLeaseToken(LEASE_TOKEN)) {
    throw new Error('test fixture is not a valid LeaseToken');
  }
  return LEASE_TOKEN;
};

const messageId = (): MessageId => {
  const value: string = 'm_1';
  if (!DeliveryPredicates.isMessageId(value)) {
    throw new Error('test fixture is not a valid MessageId');
  }
  return value;
};

const durationMs = (value: number): DurationMs => {
  if (!DurationPredicates.isDurationMs(value)) {
    throw new Error(`test fixture ${value} is not a valid DurationMs`);
  }
  return value;
};

const transitionedAlarm = (transition: AlarmTransition): Alarm => {
  if (transition.kind !== 'transitioned') {
    throw new Error(`test fixture alarm transition failed: ${transition.error.code}`);
  }
  return transition.alarm;
};

const transitioned = (transition: DeliveryTransition): Delivery => {
  if (transition.kind !== 'transitioned') {
    throw new Error(`test fixture delivery transition failed: ${transition.kind}`);
  }
  return transition.delivery;
};

const draftAlarm = (draft: Readonly<AlarmDraft>): Alarm => {
  const creation: AlarmCreation = Alarm.create(alarmId(ALARM_ID), draft, at(CREATED_ISO));
  if (creation.kind !== 'created') {
    throw new Error(`test fixture alarm is invalid: ${creation.error.code}`);
  }
  return creation.alarm;
};

const dispatchedUrgent = (): Alarm =>
  transitionedAlarm(
    draftAlarm({
      title: '서버 점검',
      body: '10분 뒤 점검',
      kind: 'URGENT',
      recipientIds: ['u_000001'],
    }).startDispatch(at(DISPATCHED_ISO)),
  );

const dispatchedBulk = (): Alarm =>
  transitionedAlarm(
    draftAlarm({
      title: '추석 이벤트',
      body: '쿠폰 도착',
      kind: 'BULK',
      recipientIds: [],
    }).startDispatch(at(DISPATCHED_ISO)),
  );

const pendingWith =
  (priority: DeliveryPriority): DeliveryBuilder =>
  (index: number): Delivery =>
    Delivery.create(
      {
        id: deliveryId(index),
        alarmId: alarmId(ALARM_ID),
        recipientId: recipientId(index),
        priority,
      },
      at(DISPATCHED_ISO),
    );

const pending: DeliveryBuilder = pendingWith('URGENT');

const started: DeliveryBuilder = (index: number): Delivery =>
  transitioned(
    transitioned(
      pending(index).claim(leaseToken(), at(DISPATCHED_ISO), durationMs(60_000)),
    ).startRequest(leaseToken(), at(DISPATCHED_ISO), durationMs(10_000)),
  );

const sent: DeliveryBuilder = (index: number): Delivery =>
  transitioned(started(index).recordAccepted(leaseToken(), messageId(), at(SETTLED_ISO)));

const failed: DeliveryBuilder = (index: number): Delivery =>
  transitioned(started(index).recordPermanentFailure(leaseToken(), 'RECIPIENT_BLOCKED'));

const unconfirmed: DeliveryBuilder = (index: number): Delivery =>
  transitioned(
    transitioned(
      started(index).recordUnknown(leaseToken(), at(SETTLED_ISO), durationMs(35_000)),
    ).expireUnconfirmed(at(NOW_ISO), durationMs(600_000)),
  );

const cancelled: DeliveryBuilder = (index: number): Delivery =>
  transitioned(pending(index).cancel(at(SETTLED_ISO)));

class FixedClock implements ClockPort {
  now(): Date {
    return at(NOW_ISO);
  }
}

const fixture = async (alarm: Alarm, deliveries: ReadonlyArray<Delivery>): Promise<Fixture> => {
  const alarmRepository: InMemoryAlarmRepositoryAdapter = new InMemoryAlarmRepositoryAdapter();
  const deliveryRepository: InMemoryDeliveryRepositoryAdapter =
    new InMemoryDeliveryRepositoryAdapter();
  const expansionJobRepository: InMemoryExpansionJobRepositoryAdapter =
    new InMemoryExpansionJobRepositoryAdapter();
  await alarmRepository.save(alarm);
  await deliveryRepository.saveAll(deliveries);
  return {
    alarmRepository,
    expansionJobRepository,
    service: new CompleteAlarmIfSettledService(
      new InMemoryUnitOfWorkAdapter({
        alarmRepository,
        deliveryRepository,
        expansionJobRepository,
      }),
      new FixedClock(),
    ),
  };
};

const completeExpansion = async (
  expansionJobRepository: InMemoryExpansionJobRepositoryAdapter,
): Promise<void> => {
  await expansionJobRepository.enqueue(alarmId(ALARM_ID), at(DISPATCHED_ISO));
  await expansionJobRepository.recordProgress(alarmId(ALARM_ID), {
    kind: 'completed',
    completedAt: at(SETTLED_ISO),
  });
};

const storedState = async (
  alarmRepository: InMemoryAlarmRepositoryAdapter,
): Promise<AlarmState> => {
  const lookup: AlarmLookup = await alarmRepository.findById(alarmId(ALARM_ID));
  if (lookup.kind !== 'found') {
    throw new Error('expected the alarm to be stored');
  }
  return lookup.alarm.snapshot().state;
};

describe('CompleteAlarmIfSettledService', () => {
  it('UC-12 발송 결과 확정 · reconcile 확정 · 확장 완료(수신자 0명 포함) / 완료 판정 유스케이스 → 확장 완료이고 미종결 Delivery가 0건이면(UNCONFIRMED는 종결로 셈) 알림이 COMPLETED가 된다', async (): Promise<void> => {
    const { alarmRepository, service }: Fixture = await fixture(dispatchedUrgent(), [
      sent(1),
      failed(2),
      unconfirmed(3),
      cancelled(4),
    ]);

    expect(await service.execute(alarmId(ALARM_ID))).toEqual({ kind: 'completed' });
    expect(await storedState(alarmRepository)).toEqual({
      status: 'COMPLETED',
      dispatchedAt: at(DISPATCHED_ISO),
      completedAt: at(NOW_ISO),
    });
  });

  it('UC-12 미종결 Delivery가 남아 있으면 알림은 DISPATCHING으로 남는다', async (): Promise<void> => {
    const { alarmRepository, service }: Fixture = await fixture(dispatchedUrgent(), [
      sent(1),
      started(2),
    ]);

    expect(await service.execute(alarmId(ALARM_ID))).toEqual({ kind: 'not-yet' });
    expect((await storedState(alarmRepository)).status).toBe('DISPATCHING');
  });

  it('UC-12 대량 알림의 확장이 끝나지 않았으면 Delivery가 모두 종결돼도 완료하지 않는다', async (): Promise<void> => {
    const { alarmRepository, expansionJobRepository, service }: Fixture = await fixture(
      dispatchedBulk(),
      [transitioned(pendingWith('BULK')(1).cancel(at(SETTLED_ISO)))],
    );
    await expansionJobRepository.enqueue(alarmId(ALARM_ID), at(DISPATCHED_ISO));

    expect(await service.execute(alarmId(ALARM_ID))).toEqual({ kind: 'not-yet' });
    expect((await storedState(alarmRepository)).status).toBe('DISPATCHING');
  });

  it('UC-12 수신자가 0명인 대량 알림은 확장이 끝나면 바로 완료된다', async (): Promise<void> => {
    const { alarmRepository, expansionJobRepository, service }: Fixture = await fixture(
      dispatchedBulk(),
      [],
    );
    await completeExpansion(expansionJobRepository);

    expect(await service.execute(alarmId(ALARM_ID))).toEqual({ kind: 'completed' });
    expect((await storedState(alarmRepository)).status).toBe('COMPLETED');
  });

  it('UC-12 확장 작업이 없는 대량 알림은 확장이 끝나지 않은 것으로 본다', async (): Promise<void> => {
    const { service }: Fixture = await fixture(dispatchedBulk(), []);

    expect(await service.execute(alarmId(ALARM_ID))).toEqual({ kind: 'not-yet' });
  });

  it('UC-12 DISPATCHING이 아닌 알림은 상태 충돌을 반환한다', async (): Promise<void> => {
    const { service }: Fixture = await fixture(
      transitionedAlarm(dispatchedUrgent().cancel(at(SETTLED_ISO))),
      [],
    );

    expect(await service.execute(alarmId(ALARM_ID))).toEqual({
      kind: 'conflict',
      error: { code: 'ALARM_STATE_CONFLICT', status: 'CANCELLED', action: 'complete' },
    });
  });

  it('UC-02 없는 알림은 알림 없음 오류를 반환한다', async (): Promise<void> => {
    const { service }: Fixture = await fixture(dispatchedUrgent(), []);

    const result: CompleteAlarmResult = await service.execute(alarmId(MISSING_ALARM_ID));

    expect(result).toEqual({
      kind: 'not-found',
      error: { code: 'ALARM_NOT_FOUND', alarmId: MISSING_ALARM_ID },
    });
  });
});
