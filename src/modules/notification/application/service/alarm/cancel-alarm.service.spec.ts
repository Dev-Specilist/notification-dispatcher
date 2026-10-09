import { describe, expect, it } from 'vitest';
import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import {
  AlarmCreation,
  AlarmId,
  AlarmTransition,
  RecipientId,
} from '@/modules/notification/domain/alarm/alarm.type';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import {
  DeliveryId,
  DeliverySnapshot,
  DeliveryStatus,
  DeliveryTransition,
  LeaseToken,
  MessageId,
  RetryAfterMs,
} from '@/modules/notification/domain/delivery/delivery.type';
import { DurationPredicates } from '@/shared/domain/duration.predicate';
import { DurationMs } from '@/shared/domain/duration.type';
import { AlarmLookup } from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.type';
import { ClockPort } from '@/modules/notification/application/port/driven/for-telling-time/clock.port';
import { CancelAlarmResult } from '@/modules/notification/application/port/driving/for-managing-alarms/cancel-alarm.type';
import { CancelAlarmService } from '@/modules/notification/application/service/alarm/cancel-alarm.service';
import { InMemoryAlarmRepositoryAdapter } from '@/modules/notification/testing/in-memory/in-memory-alarm-repository.adapter';
import { InMemoryDeliveryRepositoryAdapter } from '@/modules/notification/testing/in-memory/in-memory-delivery-repository.adapter';
import { InMemoryExpansionJobRepositoryAdapter } from '@/modules/notification/testing/in-memory/in-memory-expansion-job-repository.adapter';
import { InMemoryTransactionAdapter } from '@/modules/notification/testing/in-memory/in-memory-transaction.adapter';
import { UnusedTransaction } from '@/modules/notification/testing/unused-transaction';
import { KindAssertion, KindMember } from '@/shared/testing/kind.assertion';

type DeliveryBuilder = (index: number) => Delivery;

type StatusByRecipient = Readonly<[string, DeliveryStatus]>;

interface Fixture {
  readonly alarmRepository: InMemoryAlarmRepositoryAdapter;
  readonly deliveryRepository: InMemoryDeliveryRepositoryAdapter;
  readonly service: CancelAlarmService;
}

const CREATED_ISO: string = '2026-10-07T09:00:00.000Z';
const DISPATCHED_ISO: string = '2026-10-07T09:05:00.000Z';
const CANCELLED_ISO: string = '2026-10-07T09:10:00.000Z';
const ALARM_ID: string = '0b6c1b4e-9a37-4c2a-8d6a-2f6b2d7f1a10';
const OTHER_ALARM_ID: string = '1c7d2c5f-0b48-4d3b-9e7b-3a7c3e8f2b21';
const MISSING_ALARM_ID: string = '7d3f1e2a-4b5c-4d6e-8f70-1a2b3c4d5e6f';

const alarmId = (value: string): AlarmId => {
  if (!AlarmPredicates.isAlarmId(value)) {
    throw new Error(`test fixture ${value} is not a valid AlarmId`);
  }
  return value;
};

const recipientId = (index: number): RecipientId => {
  const rawRecipientId: string = `u_${String(index).padStart(6, '0')}`;
  if (!AlarmPredicates.isRecipientId(rawRecipientId)) {
    throw new Error(`test fixture ${rawRecipientId} is not a valid RecipientId`);
  }
  return rawRecipientId;
};

const deliveryId = (index: number): DeliveryId => {
  const rawDeliveryId: string = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  if (!DeliveryPredicates.isDeliveryId(rawDeliveryId)) {
    throw new Error(`test fixture ${rawDeliveryId} is not a valid DeliveryId`);
  }
  return rawDeliveryId;
};

const leaseToken = (): LeaseToken => {
  const rawLeaseToken: string = '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7caa';
  if (!DeliveryPredicates.isLeaseToken(rawLeaseToken)) {
    throw new Error('test fixture is not a valid LeaseToken');
  }
  return rawLeaseToken;
};

const messageId = (): MessageId => {
  const rawMessageId: string = 'm_1';
  if (!DeliveryPredicates.isMessageId(rawMessageId)) {
    throw new Error('test fixture is not a valid MessageId');
  }
  return rawMessageId;
};

const retryAfterMs = (value: number): RetryAfterMs => {
  if (!DeliveryPredicates.isRetryAfterMs(value)) {
    throw new Error(`test fixture ${value} is not a valid RetryAfterMs`);
  }
  return value;
};

const durationMs = (value: number): DurationMs => {
  if (!DurationPredicates.isDurationMs(value)) {
    throw new Error(`test fixture ${value} is not a valid DurationMs`);
  }
  return value;
};

const transitioned = (result: DeliveryTransition): Delivery => {
  KindAssertion.assertKind(result, 'transitioned');
  const { delivery }: KindMember<DeliveryTransition, 'transitioned'> = result;
  return delivery;
};

const at = (iso: string): Date => new Date(iso);

const pendingFor =
  (ownerId: string): DeliveryBuilder =>
  (index: number): Delivery =>
    Delivery.create(
      {
        id: deliveryId(index),
        alarmId: alarmId(ownerId),
        recipientId: recipientId(index),
        priority: 'URGENT',
      },
      at(DISPATCHED_ISO),
    );

const pending: DeliveryBuilder = pendingFor(ALARM_ID);

const inFlight: DeliveryBuilder = (index: number): Delivery =>
  transitioned(pending(index).claim(leaseToken(), at(DISPATCHED_ISO), durationMs(60_000)));

const started: DeliveryBuilder = (index: number): Delivery =>
  transitioned(inFlight(index).startRequest(leaseToken(), at(DISPATCHED_ISO), durationMs(10_000)));

const retryWaiting: DeliveryBuilder = (index: number): Delivery =>
  transitioned(
    started(index).recordRateLimited(leaseToken(), at(DISPATCHED_ISO), retryAfterMs(1_000)),
  );

const sent: DeliveryBuilder = (index: number): Delivery =>
  transitioned(started(index).recordAccepted(leaseToken(), messageId(), at(DISPATCHED_ISO)));

const urgentAlarm = (ownerId: string): Alarm => {
  const creation: AlarmCreation = Alarm.create(
    alarmId(ownerId),
    { title: '서버 점검', body: '10분 뒤 점검', kind: 'URGENT', recipientIds: ['u_000001'] },
    at(CREATED_ISO),
  );
  KindAssertion.assertKind(creation, 'created');
  const { alarm }: KindMember<AlarmCreation, 'created'> = creation;
  return alarm;
};

const dispatched = (alarm: Alarm): Alarm => {
  const transition: AlarmTransition = alarm.startDispatch(at(DISPATCHED_ISO));
  KindAssertion.assertKind(transition, 'transitioned');
  const { alarm: dispatchedAlarm }: KindMember<AlarmTransition, 'transitioned'> = transition;
  return dispatchedAlarm;
};

const found = (lookup: AlarmLookup): Alarm => {
  KindAssertion.assertKind(lookup, 'found');
  const { alarm }: KindMember<AlarmLookup, 'found'> = lookup;
  return alarm;
};

class FixedClock implements ClockPort {
  now(): Date {
    return at(CANCELLED_ISO);
  }
}

class FailingDeliveryRepository extends InMemoryDeliveryRepositoryAdapter {
  override cancelWaiting(): Promise<void> {
    return Promise.reject(new Error('delivery storage is unavailable'));
  }
}

class PartiallyCancellingDeliveryRepository extends InMemoryDeliveryRepositoryAdapter {
  override async cancelWaiting(ownerId: AlarmId, now: Readonly<Date>): Promise<void> {
    await super.cancelWaiting(ownerId, now);
    throw new Error('delivery storage failed midway');
  }
}

const fixture = async (
  alarms: ReadonlyArray<Alarm>,
  deliveries: ReadonlyArray<Delivery>,
  deliveryRepository: InMemoryDeliveryRepositoryAdapter = new InMemoryDeliveryRepositoryAdapter(),
): Promise<Fixture> => {
  const alarmRepository: InMemoryAlarmRepositoryAdapter = new InMemoryAlarmRepositoryAdapter();
  await Promise.all(alarms.map((alarm: Alarm): Promise<void> => alarmRepository.save(alarm)));
  await deliveryRepository.saveAll(deliveries);
  const transaction: InMemoryTransactionAdapter = new InMemoryTransactionAdapter({
    alarmRepository,
    deliveryRepository,
    expansionJobRepository: new InMemoryExpansionJobRepositoryAdapter(),
  });
  return {
    alarmRepository,
    deliveryRepository,
    service: new CancelAlarmService(transaction, new FixedClock()),
  };
};

const statusesOf = async (
  deliveryRepository: InMemoryDeliveryRepositoryAdapter,
  ownerId: string,
): Promise<ReadonlyArray<StatusByRecipient>> =>
  (await deliveryRepository.findByAlarmId(alarmId(ownerId))).map(
    (delivery: Delivery): StatusByRecipient => {
      const { recipientId: owner, state }: DeliverySnapshot = delivery.snapshot();
      return [owner, state.status];
    },
  );

const storedStatus = async (alarmRepository: InMemoryAlarmRepositoryAdapter): Promise<string> =>
  found(await alarmRepository.findById(alarmId(ALARM_ID))).snapshot().state.status;

describe('CancelAlarmService', () => {
  it('UC-02 알림 id 형식이 아닌 값으로 취소하면 저장소를 거치지 않고 알림 없음 오류가 난다', async (): Promise<void> => {
    const service: CancelAlarmService = new CancelAlarmService(
      new UnusedTransaction(),
      new FixedClock(),
    );

    expect(await service.execute({ alarmId: 'not-a-uuid' })).toEqual({
      kind: 'not-found',
      error: { code: 'ALARM_NOT_FOUND', alarmId: 'not-a-uuid' },
    });
  });

  it('UC-02 없는 알림 id / 조회·발송 시작·취소 → 알림 없음 오류가 난다', async (): Promise<void> => {
    const { service }: Fixture = await fixture([urgentAlarm(ALARM_ID)], []);

    expect(await service.execute({ alarmId: MISSING_ALARM_ID })).toEqual({
      kind: 'not-found',
      error: { code: 'ALARM_NOT_FOUND', alarmId: MISSING_ALARM_ID },
    });
  });

  it('UC-13 취소된 알림의 대기 Delivery / 취소 유스케이스 → 대기 Delivery가 한 번에 CANCELLED가 되고 처리 중인 건은 결과 확정 후 정리된다', async (): Promise<void> => {
    const { alarmRepository, deliveryRepository, service }: Fixture = await fixture(
      [dispatched(urgentAlarm(ALARM_ID))],
      [pending(1), retryWaiting(2), inFlight(3), started(4), sent(5)],
    );

    const result: CancelAlarmResult = await service.execute({ alarmId: ALARM_ID });

    expect(result.kind).toBe('cancelled');
    expect(found(await alarmRepository.findById(alarmId(ALARM_ID))).snapshot().state).toEqual({
      status: 'CANCELLED',
      cancelledAt: at(CANCELLED_ISO),
      dispatch: { kind: 'STARTED', at: at(DISPATCHED_ISO) },
    });
    expect(await statusesOf(deliveryRepository, ALARM_ID)).toEqual([
      ['u_000001', 'CANCELLED'],
      ['u_000002', 'CANCELLED'],
      ['u_000003', 'IN_FLIGHT'],
      ['u_000004', 'IN_FLIGHT'],
      ['u_000005', 'SENT'],
    ]);
  });

  it('UC-13 다른 알림의 대기 Delivery는 취소되지 않는다', async (): Promise<void> => {
    const { deliveryRepository, service }: Fixture = await fixture(
      [dispatched(urgentAlarm(ALARM_ID)), dispatched(urgentAlarm(OTHER_ALARM_ID))],
      [pending(1), pendingFor(OTHER_ALARM_ID)(2)],
    );

    await service.execute({ alarmId: ALARM_ID });

    expect(await statusesOf(deliveryRepository, OTHER_ALARM_ID)).toEqual([['u_000002', 'PENDING']]);
  });

  it('UC-13 발송 전 DRAFT 알림도 취소할 수 있다', async (): Promise<void> => {
    const { alarmRepository, service }: Fixture = await fixture([urgentAlarm(ALARM_ID)], []);

    expect((await service.execute({ alarmId: ALARM_ID })).kind).toBe('cancelled');
    expect(found(await alarmRepository.findById(alarmId(ALARM_ID))).snapshot().state).toEqual({
      status: 'CANCELLED',
      cancelledAt: at(CANCELLED_ISO),
      dispatch: { kind: 'NEVER' },
    });
  });

  it('UC-13 이미 취소된 알림은 상태 충돌을 반환하고 Delivery는 바뀌지 않는다', async (): Promise<void> => {
    const { deliveryRepository, service }: Fixture = await fixture(
      [dispatched(urgentAlarm(ALARM_ID))],
      [inFlight(1)],
    );
    await service.execute({ alarmId: ALARM_ID });

    const repeatedCancel: CancelAlarmResult = await service.execute({ alarmId: ALARM_ID });

    expect(repeatedCancel).toEqual({
      kind: 'conflict',
      error: { code: 'ALARM_STATE_CONFLICT', status: 'CANCELLED', action: 'cancel' },
    });
    expect(await statusesOf(deliveryRepository, ALARM_ID)).toEqual([['u_000001', 'IN_FLIGHT']]);
  });

  it('UC-13 대기 Delivery를 취소한 뒤 실패해도 취소한 Delivery까지 롤백된다', async (): Promise<void> => {
    const deliveryRepository: PartiallyCancellingDeliveryRepository =
      new PartiallyCancellingDeliveryRepository();
    const { alarmRepository, service }: Fixture = await fixture(
      [dispatched(urgentAlarm(ALARM_ID))],
      [pending(1), retryWaiting(2)],
      deliveryRepository,
    );

    await expect(service.execute({ alarmId: ALARM_ID })).rejects.toThrow(
      'delivery storage failed midway',
    );
    expect(await storedStatus(alarmRepository)).toBe('DISPATCHING');
    expect(await statusesOf(deliveryRepository, ALARM_ID)).toEqual([
      ['u_000001', 'PENDING'],
      ['u_000002', 'RETRY_WAIT'],
    ]);
  });

  it('UC-13 대기 Delivery 취소에 실패하면 전체가 롤백되어 알림은 취소되지 않는다', async (): Promise<void> => {
    const { alarmRepository, service }: Fixture = await fixture(
      [dispatched(urgentAlarm(ALARM_ID))],
      [pending(1)],
      new FailingDeliveryRepository(),
    );

    await expect(service.execute({ alarmId: ALARM_ID })).rejects.toThrow(
      'delivery storage is unavailable',
    );
    expect(await storedStatus(alarmRepository)).toBe('DISPATCHING');
  });
});
