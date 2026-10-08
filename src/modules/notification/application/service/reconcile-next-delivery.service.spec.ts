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
  DeliveryState,
  DeliveryTransition,
  JitterRatio,
  LeaseToken,
  MessageId,
  RecordedMessage,
} from '@/modules/notification/domain/delivery/delivery.type';
import { RetryPolicy } from '@/modules/notification/domain/delivery/retry-policy';
import { RetryPolicyCreation } from '@/modules/notification/domain/delivery/retry-policy.type';
import { DurationPredicates } from '@/shared/domain/duration.predicate';
import { DurationMs } from '@/shared/domain/duration.type';
import { ClockPort } from '@/modules/notification/application/port/out/clock.port';
import { JitterSourcePort } from '@/modules/notification/application/port/out/jitter-source.port';
import { MessageLookupPort } from '@/modules/notification/application/port/out/message-lookup.port';
import { MessageLookupResult } from '@/modules/notification/application/port/out/message-lookup.type';
import { ReconcileSettingsPort } from '@/modules/notification/application/port/out/reconcile-settings.port';
import { CancelAlarmService } from '@/modules/notification/application/service/cancel-alarm.service';
import { ReconcileAttempt } from '@/modules/notification/application/port/in/reconcile-next-delivery.type';
import { ReconcileNextDeliveryService } from '@/modules/notification/application/service/reconcile-next-delivery.service';
import { InMemoryAlarmRepositoryAdapter } from '@/modules/notification/adapter/out/in-memory/in-memory-alarm-repository.adapter';
import { InMemoryDeliveryRepositoryAdapter } from '@/modules/notification/adapter/out/in-memory/in-memory-delivery-repository.adapter';
import { InMemoryExpansionJobRepositoryAdapter } from '@/modules/notification/adapter/out/in-memory/in-memory-expansion-job-repository.adapter';
import { InMemoryTransactionAdapter } from '@/modules/notification/adapter/out/in-memory/in-memory-transaction.adapter';

type LookupEntry = Readonly<[DeliveryId, MessageLookupResult]>;

type MessageEntry = Readonly<[string, string]>;

type RecipientStatus = Readonly<[string, string]>;

interface Gate {
  readonly opened: Promise<void>;
  readonly open: () => void;
}

interface Fixture {
  readonly transaction: InMemoryTransactionAdapter;
  readonly deliveryRepository: InMemoryDeliveryRepositoryAdapter;
  readonly lookup: ScriptedMessageLookup;
  readonly clock: AdjustableClock;
  readonly service: ReconcileNextDeliveryService;
}

const CREATED_ISO: string = '2026-10-08T09:00:00.000Z';
const STARTED_ISO: string = '2026-10-08T09:01:00.000Z';
const TIMED_OUT_ISO: string = '2026-10-08T09:01:10.000Z';
const NOW_ISO: string = '2026-10-08T09:01:40.000Z';
const ACTIVE_ALARM_ID: string = '0b6c1b4e-9a37-4c2a-8d6a-2f6b2d7f1a10';
const CANCELLED_ALARM_ID: string = '1c7d2c5f-0b48-4d3b-9e7b-3a7c3e8f2b21';
const LEASE_TOKEN: string = '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7caa';
const RECONCILE_DELAY_MS: number = 35_000;
const UNCONFIRMED_AFTER_MS: number = 600_000;

const at = (iso: string): Date => new Date(iso);

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
  if (!DeliveryPredicates.isLeaseToken(LEASE_TOKEN)) {
    throw new Error('test fixture is not a valid LeaseToken');
  }
  return LEASE_TOKEN;
};

const messageId = (value: string): MessageId => {
  if (!DeliveryPredicates.isMessageId(value)) {
    throw new Error(`test fixture ${value} is not a valid MessageId`);
  }
  return value;
};

const durationMs = (value: number): DurationMs => {
  if (!DurationPredicates.isDurationMs(value)) {
    throw new Error(`test fixture ${value} is not a valid DurationMs`);
  }
  return value;
};

const retryPolicy = (maxAttempts: number): RetryPolicy => {
  if (!DeliveryPredicates.isAttemptLimit(maxAttempts)) {
    throw new Error(`test fixture ${maxAttempts} is not a valid AttemptLimit`);
  }
  const creation: RetryPolicyCreation = RetryPolicy.create({
    maxAttempts,
    baseDelayMs: durationMs(1_000),
    maxDelayMs: durationMs(8_000),
  });
  if (creation.kind !== 'created') {
    throw new Error(`test fixture retry policy is invalid: ${creation.error.code}`);
  }
  return creation.policy;
};

const transitioned = (transition: DeliveryTransition): Delivery => {
  if (transition.kind !== 'transitioned') {
    throw new Error(`test fixture delivery transition failed: ${transition.kind}`);
  }
  return transition.delivery;
};

const transitionedAlarm = (transition: AlarmTransition): Alarm => {
  if (transition.kind !== 'transitioned') {
    throw new Error(`test fixture alarm transition failed: ${transition.error.code}`);
  }
  return transition.alarm;
};

const dispatchedAlarm = (rawAlarmId: string): Alarm => {
  const creation: AlarmCreation = Alarm.create(
    alarmId(rawAlarmId),
    { title: '추석 이벤트', body: '쿠폰 도착', kind: 'BULK', recipientIds: [] },
    at(CREATED_ISO),
  );
  if (creation.kind !== 'created') {
    throw new Error(`test fixture alarm is invalid: ${creation.error.code}`);
  }
  return transitionedAlarm(creation.alarm.startDispatch(at(STARTED_ISO)));
};

const unknownDelivery = (index: number, owner: string = ACTIVE_ALARM_ID): Delivery => {
  const pending: Delivery = Delivery.create(
    {
      id: deliveryId(index),
      alarmId: alarmId(owner),
      recipientId: recipientId(index),
      priority: 'BULK',
    },
    at(CREATED_ISO),
  );
  const started: Delivery = transitioned(
    transitioned(pending.claim(leaseToken(), at(STARTED_ISO), durationMs(60_000))).startRequest(
      leaseToken(),
      at(STARTED_ISO),
      durationMs(10_000),
    ),
  );
  return transitioned(
    started.recordUnknown(leaseToken(), at(TIMED_OUT_ISO), durationMs(RECONCILE_DELAY_MS)),
  );
};

const NOT_YET_OPENED: () => void = (): void => {};

const createGate = (): Gate => {
  let release: () => void = NOT_YET_OPENED;
  const opened: Promise<void> = new Promise<void>((resolve: () => void): void => {
    release = resolve;
  });
  return { opened, open: (): void => release() };
};

class AdjustableClock implements ClockPort {
  private current: Date = at(NOW_ISO);

  now(): Date {
    return new Date(this.current.getTime());
  }

  advanceBy(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

class ZeroJitter implements JitterSourcePort {
  next(): JitterRatio {
    const ratio: number = 0;
    if (!DeliveryPredicates.isJitterRatio(ratio)) {
      throw new Error('test fixture jitter is invalid');
    }
    return ratio;
  }
}

class FixedReconcileSettings implements ReconcileSettingsPort {
  readonly retryPolicy: RetryPolicy;

  readonly lookupRetryPolicy: RetryPolicy = retryPolicy(3);

  readonly unconfirmedAfterMs: DurationMs = durationMs(UNCONFIRMED_AFTER_MS);

  constructor(maxAttempts: number = 3) {
    this.retryPolicy = retryPolicy(maxAttempts);
  }
}

class ScriptedMessageLookup implements MessageLookupPort {
  readonly requested: Array<DeliveryId> = [];

  private readonly resultsByClientRef: ReadonlyMap<DeliveryId, MessageLookupResult>;

  constructor(entries: ReadonlyArray<LookupEntry>) {
    this.resultsByClientRef = new Map<DeliveryId, MessageLookupResult>(entries);
  }

  findByClientRef(clientRef: DeliveryId): Promise<MessageLookupResult> {
    this.requested.push(clientRef);
    return Promise.resolve(this.resultsByClientRef.get(clientRef) ?? { kind: 'none' });
  }
}

class PausingMessageLookup extends ScriptedMessageLookup {
  readonly looking: Gate = createGate();

  readonly answered: Gate = createGate();

  override async findByClientRef(clientRef: DeliveryId): Promise<MessageLookupResult> {
    this.looking.open();
    await this.answered.opened;
    return super.findByClientRef(clientRef);
  }
}

const recordedMessage = ([id, sentIso]: MessageEntry): RecordedMessage => ({
  messageId: messageId(id),
  sentAt: at(sentIso),
});

const found = (first: MessageEntry, ...rest: ReadonlyArray<MessageEntry>): MessageLookupResult => ({
  kind: 'found',
  messages: [recordedMessage(first), ...rest.map(recordedMessage)],
});

const fixture = async (
  deliveries: ReadonlyArray<Delivery>,
  lookup: ScriptedMessageLookup,
  settings: FixedReconcileSettings = new FixedReconcileSettings(),
): Promise<Fixture> => {
  const alarmRepository: InMemoryAlarmRepositoryAdapter = new InMemoryAlarmRepositoryAdapter();
  await alarmRepository.save(dispatchedAlarm(ACTIVE_ALARM_ID));
  await alarmRepository.save(
    transitionedAlarm(dispatchedAlarm(CANCELLED_ALARM_ID).cancel(at(TIMED_OUT_ISO))),
  );
  const deliveryRepository: InMemoryDeliveryRepositoryAdapter =
    new InMemoryDeliveryRepositoryAdapter();
  await deliveryRepository.saveAll(deliveries);
  const clock: AdjustableClock = new AdjustableClock();
  const transaction: InMemoryTransactionAdapter = new InMemoryTransactionAdapter({
    alarmRepository,
    deliveryRepository,
    expansionJobRepository: new InMemoryExpansionJobRepositoryAdapter(),
  });
  return {
    transaction,
    deliveryRepository,
    lookup,
    clock,
    service: new ReconcileNextDeliveryService(
      transaction,
      lookup,
      clock,
      settings,
      new ZeroJitter(),
    ),
  };
};

const stateOf = async (
  deliveryRepository: InMemoryDeliveryRepositoryAdapter,
  owner: string = ACTIVE_ALARM_ID,
): Promise<DeliveryState> => {
  const [stored]: ReadonlyArray<Delivery> = await deliveryRepository.findByAlarmId(alarmId(owner));
  return stored.snapshot().state;
};

const statuses = async (
  deliveryRepository: InMemoryDeliveryRepositoryAdapter,
  owner: string,
): Promise<ReadonlyArray<RecipientStatus>> =>
  (await deliveryRepository.findByAlarmId(alarmId(owner))).map(
    (delivery: Delivery): RecipientStatus => {
      const { recipientId: recipient, state }: DeliverySnapshot = delivery.snapshot();
      return [recipient, state.status];
    },
  );

describe('ReconcileNextDeliveryService', () => {
  it('UC-14 reconcile 가능 시각이 지난 UNKNOWN Delivery 여러 건 / reconcile 유스케이스 → 건마다 발송 내역을 조회해 DLV-09~13, DLV-19, DLV-21 규칙대로 확정한다', async (): Promise<void> => {
    const { deliveryRepository, service }: Fixture = await fixture(
      [
        unknownDelivery(1),
        unknownDelivery(2),
        unknownDelivery(3),
        unknownDelivery(4),
        unknownDelivery(5, CANCELLED_ALARM_ID),
      ],
      new ScriptedMessageLookup([
        [deliveryId(1), found(['m_1', TIMED_OUT_ISO])],
        [deliveryId(3), { kind: 'lookup-failed' }],
        [deliveryId(4), found(['m_4b', NOW_ISO], ['m_4a', TIMED_OUT_ISO])],
      ]),
    );

    const attempts: ReadonlyArray<ReconcileAttempt> = [
      await service.execute(),
      await service.execute(),
      await service.execute(),
      await service.execute(),
      await service.execute(),
      await service.execute(),
    ];

    expect(attempts.map((attempt: ReconcileAttempt): string => attempt.kind)).toEqual([
      'reconciled',
      'reconciled',
      'reconciled',
      'reconciled',
      'reconciled',
      'idle',
    ]);
    expect(await statuses(deliveryRepository, ACTIVE_ALARM_ID)).toEqual([
      ['u_000001', 'SENT'],
      ['u_000002', 'RETRY_WAIT'],
      ['u_000003', 'UNKNOWN'],
      ['u_000004', 'SENT'],
    ]);
    expect(await statuses(deliveryRepository, CANCELLED_ALARM_ID)).toEqual([
      ['u_000005', 'CANCELLED'],
    ]);
    const [_sent, _retrying, lookupFailed, duplicated]: ReadonlyArray<Delivery> =
      await deliveryRepository.findByAlarmId(alarmId(ACTIVE_ALARM_ID));
    expect(lookupFailed.snapshot().state).toMatchObject({
      lookupFailures: 1,
      reconcileAt: new Date(at(NOW_ISO).getTime() + 500),
    });
    expect(duplicated.snapshot().state).toEqual({
      status: 'SENT',
      messageId: 'm_4a',
      sentAt: at(TIMED_OUT_ISO),
      duplicateCount: 1,
    });
  });

  it('UC-14 reconcile 가능 시각 전의 UNKNOWN Delivery는 발송 내역을 조회하지 않는다', async (): Promise<void> => {
    const { lookup, clock, service }: Fixture = await fixture(
      [unknownDelivery(1)],
      new ScriptedMessageLookup([]),
    );
    clock.advanceBy(-10_000);

    expect(await service.execute()).toEqual({ kind: 'idle' });
    expect(lookup.requested).toEqual([]);
  });

  it('UC-14 발송 내역이 없고 시도 횟수를 다 썼으면 FAILED(RETRY_EXHAUSTED)로 확정한다', async (): Promise<void> => {
    const { deliveryRepository, service }: Fixture = await fixture(
      [unknownDelivery(1)],
      new ScriptedMessageLookup([]),
      new FixedReconcileSettings(1),
    );

    await service.execute();

    expect(await stateOf(deliveryRepository)).toEqual({
      status: 'FAILED',
      reason: 'RETRY_EXHAUSTED',
    });
  });

  it('UC-14 조회가 실패했고 확인 기간이 지났으면 UNCONFIRMED로 종결한다', async (): Promise<void> => {
    const { deliveryRepository, clock, service }: Fixture = await fixture(
      [unknownDelivery(1)],
      new ScriptedMessageLookup([[deliveryId(1), { kind: 'lookup-failed' }]]),
    );
    clock.advanceBy(UNCONFIRMED_AFTER_MS);

    await service.execute();

    expect(await stateOf(deliveryRepository)).toEqual({
      status: 'UNCONFIRMED',
      unknownSince: at(TIMED_OUT_ISO),
      unconfirmedAt: new Date(at(NOW_ISO).getTime() + UNCONFIRMED_AFTER_MS),
    });
  });

  it('UC-14 확인 기간이 지났어도 발송 내역이 나오면 UNCONFIRMED가 아니라 SENT로 확정한다', async (): Promise<void> => {
    const { deliveryRepository, clock, service }: Fixture = await fixture(
      [unknownDelivery(1)],
      new ScriptedMessageLookup([[deliveryId(1), found(['m_1', TIMED_OUT_ISO])]]),
    );
    clock.advanceBy(UNCONFIRMED_AFTER_MS);

    await service.execute();

    expect((await stateOf(deliveryRepository)).status).toBe('SENT');
  });

  it('UC-14 조회하는 동안 다른 워커가 같은 Delivery의 조회 실패를 기록하고 재조회를 예약했으면 늦은 결과를 저장하지 않는다', async (): Promise<void> => {
    const lookup: PausingMessageLookup = new PausingMessageLookup([
      [deliveryId(1), found(['m_1', TIMED_OUT_ISO])],
    ]);
    const { deliveryRepository, service }: Fixture = await fixture([unknownDelivery(1)], lookup);
    const attempt: Promise<ReconcileAttempt> = service.execute();
    await lookup.looking.opened;

    const otherWorkerResult: Delivery = transitioned(
      unknownDelivery(1).recordLookupFailure(at(NOW_ISO), retryPolicy(3), new ZeroJitter().next()),
    );
    await deliveryRepository.saveAll([otherWorkerResult]);
    lookup.answered.open();

    expect(await attempt).toEqual({ kind: 'superseded', deliveryId: deliveryId(1) });
    expect(await stateOf(deliveryRepository)).toMatchObject({
      status: 'UNKNOWN',
      lookupFailures: 1,
    });
  });

  it('UC-14 조회하는 동안 알림이 취소되고 발송 내역이 없으면 재시도 대신 CANCELLED로 확정한다', async (): Promise<void> => {
    const lookup: PausingMessageLookup = new PausingMessageLookup([]);
    const { transaction, deliveryRepository, clock, service }: Fixture = await fixture(
      [unknownDelivery(1)],
      lookup,
    );
    const attempt: Promise<ReconcileAttempt> = service.execute();
    await lookup.looking.opened;

    await new CancelAlarmService(transaction, clock).execute(alarmId(ACTIVE_ALARM_ID));
    lookup.answered.open();

    expect(await attempt).toEqual({
      kind: 'reconciled',
      deliveryId: deliveryId(1),
      status: 'CANCELLED',
    });
    expect((await stateOf(deliveryRepository)).status).toBe('CANCELLED');
  });
});
