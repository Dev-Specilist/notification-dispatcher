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
  DeliveryState,
  DeliveryTransition,
  JitterRatio,
  LeaseToken,
  MessageId,
} from '@/modules/notification/domain/delivery/delivery.type';
import { RetryPolicy } from '@/modules/notification/domain/delivery/retry-policy';
import { RetryPolicyCreation } from '@/modules/notification/domain/delivery/retry-policy.type';
import { DurationPredicates } from '@/shared/domain/duration.predicate';
import { DurationMs } from '@/shared/domain/duration.type';
import { ClockPort } from '@/modules/notification/application/port/clock.port';
import { DispatchSettingsPort } from '@/modules/notification/application/port/dispatch-settings.port';
import { JitterSourcePort } from '@/modules/notification/application/port/jitter-source.port';
import { LeaseRecoverySettingsPort } from '@/modules/notification/application/port/lease-recovery-settings.port';
import { LeaseTokenGeneratorPort } from '@/modules/notification/application/port/lease-token-generator.port';
import { MessageLookupPort } from '@/modules/notification/application/port/message-lookup.port';
import { MessageLookupResult } from '@/modules/notification/application/port/message-lookup.type';
import { MessageSenderPort } from '@/modules/notification/application/port/message-sender.port';
import {
  OutgoingMessage,
  SendOutcome,
} from '@/modules/notification/application/port/message-sender.type';
import { ReconcileSettingsPort } from '@/modules/notification/application/port/reconcile-settings.port';
import { SendPermitPort } from '@/modules/notification/application/port/send-permit.port';
import { SendPermit } from '@/modules/notification/application/port/send-permit.type';
import { ReconcileNextDeliveryUseCase } from '@/modules/notification/application/use-case/reconcile-next-delivery.use-case';
import { RecoverExpiredLeaseUseCase } from '@/modules/notification/application/use-case/recover-expired-lease.use-case';
import { SendNextDeliveryUseCase } from '@/modules/notification/application/use-case/send-next-delivery.use-case';
import { InMemoryAlarmRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-alarm-repository.adapter';
import { InMemoryDeliveryRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-delivery-repository.adapter';
import { InMemoryExpansionJobRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-expansion-job-repository.adapter';
import { InMemoryUnitOfWorkAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-unit-of-work.adapter';

interface Fixture {
  readonly deliveryRepository: InMemoryDeliveryRepositoryAdapter;
  readonly unitOfWork: InMemoryUnitOfWorkAdapter;
  readonly clock: AdjustableClock;
  readonly useCase: RecoverExpiredLeaseUseCase;
}

const CREATED_ISO: string = '2026-10-08T09:00:00.000Z';
const STARTED_ISO: string = '2026-10-08T09:01:00.000Z';
const LEASE_EXPIRES_ISO: string = '2026-10-08T09:02:00.000Z';
const ALARM_ID: string = '0b6c1b4e-9a37-4c2a-8d6a-2f6b2d7f1a10';
const LEASE_TOKEN: string = '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7caa';
const OTHER_TOKEN: string = '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7cbb';
const LEASE_MS: number = 60_000;
const RECONCILE_DELAY_MS: number = 35_000;

const at = (iso: string): Date => new Date(iso);

const alarmId = (): AlarmId => {
  if (!AlarmPredicates.isAlarmId(ALARM_ID)) {
    throw new Error('test fixture is not a valid AlarmId');
  }
  return ALARM_ID;
};

const recipientId = (index: number): RecipientId => {
  const value: string = `u_${String(index).padStart(6, '0')}`;
  if (!AlarmPredicates.isRecipientId(value)) {
    throw new Error(`test fixture ${value} is not a valid RecipientId`);
  }
  return value;
};

const deliveryId = (index: number = 1): DeliveryId => {
  const value: string = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  if (!DeliveryPredicates.isDeliveryId(value)) {
    throw new Error(`test fixture ${value} is not a valid DeliveryId`);
  }
  return value;
};

const leaseToken = (value: string): LeaseToken => {
  if (!DeliveryPredicates.isLeaseToken(value)) {
    throw new Error(`test fixture ${value} is not a valid LeaseToken`);
  }
  return value;
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

const retryPolicy = (): RetryPolicy => {
  const maxAttempts: number = 3;
  if (!DeliveryPredicates.isAttemptLimit(maxAttempts)) {
    throw new Error('test fixture is not a valid AttemptLimit');
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

const dispatchedAlarm = (): Alarm => {
  const creation: AlarmCreation = Alarm.create(
    alarmId(),
    { title: '추석 이벤트', body: '쿠폰 도착', kind: 'BULK', recipientIds: [] },
    at(CREATED_ISO),
  );
  if (creation.kind !== 'created') {
    throw new Error(`test fixture alarm is invalid: ${creation.error.code}`);
  }
  return transitionedAlarm(creation.alarm.startDispatch(at(STARTED_ISO)));
};

const requestStarted = (index: number = 1, startedIso: string = STARTED_ISO): Delivery => {
  const pending: Delivery = Delivery.create(
    {
      id: deliveryId(index),
      alarmId: alarmId(),
      recipientId: recipientId(index),
      priority: 'BULK',
    },
    at(CREATED_ISO),
  );
  const claimed: Delivery = transitioned(
    pending.claim(leaseToken(LEASE_TOKEN), at(startedIso), durationMs(LEASE_MS)),
  );
  return transitioned(
    claimed.startRequest(leaseToken(LEASE_TOKEN), at(startedIso), durationMs(10_000)),
  );
};

class AdjustableClock implements ClockPort {
  private current: Date = at(STARTED_ISO);

  now(): Date {
    return new Date(this.current.getTime());
  }

  moveTo(iso: string): void {
    this.current = at(iso);
  }

  advanceBy(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

class FixedRecoverySettings implements LeaseRecoverySettingsPort {
  readonly reconcileDelayMs: DurationMs = durationMs(RECONCILE_DELAY_MS);
}

class FixedReconcileSettings implements ReconcileSettingsPort {
  readonly retryPolicy: RetryPolicy = retryPolicy();

  readonly lookupRetryPolicy: RetryPolicy = retryPolicy();

  readonly unconfirmedAfterMs: DurationMs = durationMs(600_000);
}

class FixedDispatchSettings implements DispatchSettingsPort {
  readonly leaseMs: DurationMs = durationMs(LEASE_MS);

  readonly maxRequestMs: DurationMs = durationMs(10_000);

  readonly reconcileDelayMs: DurationMs = durationMs(RECONCILE_DELAY_MS);

  readonly retryPolicy: RetryPolicy = retryPolicy();
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

class AlwaysGrantedPermit implements SendPermitPort {
  acquire(): Promise<SendPermit> {
    return Promise.resolve({ kind: 'granted' });
  }

  holdFor(): Promise<void> {
    return Promise.resolve();
  }
}

class RecordingMessageSender implements MessageSenderPort {
  readonly sent: Array<OutgoingMessage> = [];

  send(message: OutgoingMessage): Promise<SendOutcome> {
    this.sent.push(message);
    return Promise.resolve({ kind: 'accepted', messageId: messageId() });
  }
}

class AlreadySentLookup implements MessageLookupPort {
  findByClientRef(): Promise<MessageLookupResult> {
    return Promise.resolve({
      kind: 'found',
      messages: [{ messageId: messageId(), sentAt: at(STARTED_ISO) }],
    });
  }
}

class FixedLeaseTokenGenerator implements LeaseTokenGeneratorPort {
  next(): LeaseToken {
    return leaseToken(OTHER_TOKEN);
  }
}

const fixture = async (deliveries: ReadonlyArray<Delivery>): Promise<Fixture> => {
  const alarmRepository: InMemoryAlarmRepositoryAdapter = new InMemoryAlarmRepositoryAdapter();
  await alarmRepository.save(dispatchedAlarm());
  const deliveryRepository: InMemoryDeliveryRepositoryAdapter =
    new InMemoryDeliveryRepositoryAdapter();
  await deliveryRepository.saveAll(deliveries);
  const unitOfWork: InMemoryUnitOfWorkAdapter = new InMemoryUnitOfWorkAdapter({
    alarmRepository,
    deliveryRepository,
    expansionJobRepository: new InMemoryExpansionJobRepositoryAdapter(),
  });
  const clock: AdjustableClock = new AdjustableClock();
  return {
    deliveryRepository,
    unitOfWork,
    clock,
    useCase: new RecoverExpiredLeaseUseCase(unitOfWork, clock, new FixedRecoverySettings()),
  };
};

const storedState = async (
  deliveryRepository: InMemoryDeliveryRepositoryAdapter,
): Promise<DeliveryState> => {
  const [stored]: ReadonlyArray<Delivery> = await deliveryRepository.findByAlarmId(alarmId());
  return stored.snapshot().state;
};

describe('RecoverExpiredLeaseUseCase', () => {
  it('DLV-14 lease가 만료된 IN_FLIGHT Delivery를 재전송 없이 UNKNOWN으로 넘기고 lease 만료 + RECONCILE_DELAY_MS를 reconcile 가능 시각으로 기록한다', async (): Promise<void> => {
    const { deliveryRepository, clock, useCase }: Fixture = await fixture([requestStarted()]);
    clock.moveTo(LEASE_EXPIRES_ISO);

    expect(await useCase.execute()).toEqual({ kind: 'recovered', deliveryId: deliveryId() });
    expect(await storedState(deliveryRepository)).toEqual({
      status: 'UNKNOWN',
      unknownSince: at(LEASE_EXPIRES_ISO),
      reconcileAt: new Date(at(LEASE_EXPIRES_ISO).getTime() + RECONCILE_DELAY_MS),
      lookupFailures: 0,
    });
  });

  it('DLV-14 lease가 아직 남은 IN_FLIGHT Delivery는 복구하지 않는다', async (): Promise<void> => {
    const { deliveryRepository, clock, useCase }: Fixture = await fixture([requestStarted()]);
    clock.moveTo('2026-10-08T09:01:59.999Z');

    expect(await useCase.execute()).toEqual({ kind: 'idle' });
    expect((await storedState(deliveryRepository)).status).toBe('IN_FLIGHT');
  });

  it('DLV-14 lease가 만료된 Delivery가 여러 건이면 가장 먼저 만료된 1건만 복구한다', async (): Promise<void> => {
    const { deliveryRepository, clock, useCase }: Fixture = await fixture([
      requestStarted(1, '2026-10-08T09:01:00.500Z'),
      requestStarted(2, STARTED_ISO),
    ]);
    clock.moveTo('2026-10-08T09:02:01.000Z');

    expect(await useCase.execute()).toEqual({ kind: 'recovered', deliveryId: deliveryId(2) });
    expect(
      (await deliveryRepository.findByAlarmId(alarmId())).map(
        (delivery: Delivery): string => delivery.snapshot().state.status,
      ),
    ).toEqual(['IN_FLIGHT', 'UNKNOWN']);
  });

  it('UC-15 외부 발송이 성공한 직후 결과 저장 전에 워커가 멈췄다 / lease 만료 후 복구와 reconcile을 실행한다 → 재전송 없이 SENT로 확정된다', async (): Promise<void> => {
    const { deliveryRepository, unitOfWork, clock, useCase }: Fixture = await fixture([
      requestStarted(),
    ]);
    const sender: RecordingMessageSender = new RecordingMessageSender();
    const sendWorker: SendNextDeliveryUseCase = new SendNextDeliveryUseCase(
      unitOfWork,
      new AlwaysGrantedPermit(),
      sender,
      new FixedLeaseTokenGenerator(),
      clock,
      new FixedDispatchSettings(),
      new ZeroJitter(),
    );
    const reconcileWorker: ReconcileNextDeliveryUseCase = new ReconcileNextDeliveryUseCase(
      unitOfWork,
      new AlreadySentLookup(),
      clock,
      new FixedReconcileSettings(),
      new ZeroJitter(),
    );
    clock.moveTo(LEASE_EXPIRES_ISO);

    expect(await useCase.execute()).toMatchObject({ kind: 'recovered' });
    expect(await sendWorker.execute()).toEqual({ kind: 'idle' });
    expect(await reconcileWorker.execute()).toEqual({ kind: 'idle' });
    clock.advanceBy(RECONCILE_DELAY_MS);

    expect(await reconcileWorker.execute()).toMatchObject({ kind: 'reconciled', status: 'SENT' });
    expect(await storedState(deliveryRepository)).toEqual({
      status: 'SENT',
      messageId: 'm_1',
      sentAt: at(STARTED_ISO),
      duplicateCount: 0,
    });
    expect(sender.sent).toEqual([]);
  });
});
