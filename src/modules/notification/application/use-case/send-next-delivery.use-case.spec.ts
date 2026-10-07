import { describe, expect, it } from 'vitest';
import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import {
  AlarmCreation,
  AlarmDraft,
  AlarmId,
  AlarmTransition,
  RecipientId,
} from '@/modules/notification/domain/alarm/alarm.type';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import {
  DeliveryId,
  DeliveryPriority,
  DeliverySnapshot,
  DeliveryTransition,
  LeaseToken,
  MessageId,
} from '@/modules/notification/domain/delivery/delivery.type';
import { DurationPredicates } from '@/shared/domain/duration.predicate';
import { DurationMs } from '@/shared/domain/duration.type';
import { AlarmLookup } from '@/modules/notification/application/port/alarm-repository.type';
import { ClockPort } from '@/modules/notification/application/port/clock.port';
import { DispatchSettingsPort } from '@/modules/notification/application/port/dispatch-settings.port';
import { LeaseTokenGeneratorPort } from '@/modules/notification/application/port/lease-token-generator.port';
import { MessageSenderPort } from '@/modules/notification/application/port/message-sender.port';
import {
  OutgoingMessage,
  SendOutcome,
} from '@/modules/notification/application/port/message-sender.type';
import { SendPermitPort } from '@/modules/notification/application/port/send-permit.port';
import { SendPermit } from '@/modules/notification/application/port/send-permit.type';
import { SendAttempt } from '@/modules/notification/application/use-case/send-next-delivery.type';
import { SendNextDeliveryUseCase } from '@/modules/notification/application/use-case/send-next-delivery.use-case';
import { InMemoryAlarmRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-alarm-repository.adapter';
import { InMemoryDeliveryRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-delivery-repository.adapter';
import { InMemoryExpansionJobRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-expansion-job-repository.adapter';
import { InMemoryUnitOfWorkAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-unit-of-work.adapter';
import { InMemoryRepositories } from '@/modules/notification/infrastructure/adapter/in-memory-unit-of-work.type';
import { TransactionWork } from '@/modules/notification/application/port/unit-of-work.type';

type RecipientStatus = Readonly<[string, string]>;

type UnitOfWorkFactory = (repositories: InMemoryRepositories) => InMemoryUnitOfWorkAdapter;

interface Fixture {
  readonly alarmRepository: InMemoryAlarmRepositoryAdapter;
  readonly deliveryRepository: InMemoryDeliveryRepositoryAdapter;
  readonly unitOfWork: InMemoryUnitOfWorkAdapter;
  readonly sender: RecordingMessageSender;
  readonly clock: AdjustableClock;
  readonly useCase: SendNextDeliveryUseCase;
}

interface FixtureOptions {
  readonly alarms: ReadonlyArray<Alarm>;
  readonly alarmRepository: InMemoryAlarmRepositoryAdapter;
  readonly permit: SendPermitPort;
  readonly sender: RecordingMessageSender;
  readonly createUnitOfWork: UnitOfWorkFactory;
}

interface Gate {
  readonly opened: Promise<void>;
  readonly open: () => void;
}

const CREATED_ISO: string = '2026-10-08T09:00:00.000Z';
const DISPATCHED_ISO: string = '2026-10-08T09:01:00.000Z';
const NOW_ISO: string = '2026-10-08T09:02:00.000Z';
const BULK_ALARM_ID: string = '0b6c1b4e-9a37-4c2a-8d6a-2f6b2d7f1a10';
const URGENT_ALARM_ID: string = '1c7d2c5f-0b48-4d3b-9e7b-3a7c3e8f2b21';
const LEASE_TOKEN: string = '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7caa';
const PREVIOUS_TOKEN: string = '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7cbb';

const at = (iso: string): Date => new Date(iso);

const alarmId = (value: string): AlarmId => {
  if (!AlarmPredicates.isAlarmId(value)) {
    throw new Error(`test fixture ${value} is not a valid AlarmId`);
  }
  return value;
};

const recipientId = (value: string): RecipientId => {
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

const leaseToken = (value: string): LeaseToken => {
  if (!DeliveryPredicates.isLeaseToken(value)) {
    throw new Error(`test fixture ${value} is not a valid LeaseToken`);
  }
  return value;
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

const transitionedAlarm = (transition: AlarmTransition): Alarm => {
  if (transition.kind !== 'transitioned') {
    throw new Error(`test fixture alarm transition failed: ${transition.error.code}`);
  }
  return transition.alarm;
};

const transitionedDelivery = (transition: DeliveryTransition): Delivery => {
  if (transition.kind !== 'transitioned') {
    throw new Error(`test fixture delivery transition failed: ${transition.kind}`);
  }
  return transition.delivery;
};

const dispatchedAlarm = (id: string, draft: Readonly<AlarmDraft>): Alarm => {
  const creation: AlarmCreation = Alarm.create(alarmId(id), draft, at(CREATED_ISO));
  if (creation.kind !== 'created') {
    throw new Error(`test fixture alarm is invalid: ${creation.error.code}`);
  }
  return transitionedAlarm(creation.alarm.startDispatch(at(DISPATCHED_ISO)));
};

const bulkAlarm = (): Alarm =>
  dispatchedAlarm(BULK_ALARM_ID, {
    title: '추석 이벤트',
    body: '연휴 쿠폰이 도착했어요',
    kind: 'BULK',
    recipientIds: [],
  });

const urgentAlarm = (): Alarm =>
  dispatchedAlarm(URGENT_ALARM_ID, {
    title: '서버 점검',
    body: '10분 뒤 점검이 시작됩니다',
    kind: 'URGENT',
    recipientIds: ['u_000009'],
  });

const pendingDelivery = (
  index: number,
  owner: string,
  priority: DeliveryPriority,
  createdIso: string,
): Delivery =>
  Delivery.create(
    {
      id: deliveryId(index),
      alarmId: alarmId(owner),
      recipientId: recipientId(`u_${String(index).padStart(6, '0')}`),
      priority,
    },
    at(createdIso),
  );

const retryWaitingUntil = (delivery: Delivery, retryAfterMs: number): Delivery => {
  const token: LeaseToken = leaseToken(PREVIOUS_TOKEN);
  const claimed: Delivery = transitionedDelivery(
    delivery.claim(token, at(DISPATCHED_ISO), durationMs(60_000)),
  );
  const started: Delivery = transitionedDelivery(
    claimed.startRequest(token, at(DISPATCHED_ISO), durationMs(10_000)),
  );
  return transitionedDelivery(
    started.recordRateLimited(token, at(DISPATCHED_ISO), durationMs(retryAfterMs)),
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

class FixedLeaseTokenGenerator implements LeaseTokenGeneratorPort {
  next(): LeaseToken {
    return leaseToken(LEASE_TOKEN);
  }
}

class FixedDispatchSettings implements DispatchSettingsPort {
  readonly leaseMs: DurationMs = durationMs(60_000);

  readonly maxRequestMs: DurationMs = durationMs(10_000);
}

class StubSendPermit implements SendPermitPort {
  constructor(private readonly permit: SendPermit) {}

  acquire(): Promise<SendPermit> {
    return Promise.resolve(this.permit);
  }
}

class GatedSendPermit implements SendPermitPort {
  readonly requested: Gate = createGate();

  readonly granted: Gate = createGate();

  async acquire(): Promise<SendPermit> {
    this.requested.open();
    await this.granted.opened;
    return { kind: 'granted' };
  }
}

class RecordingMessageSender implements MessageSenderPort {
  readonly sent: Array<OutgoingMessage> = [];

  send(message: OutgoingMessage): Promise<SendOutcome> {
    this.sent.push(message);
    return Promise.resolve({ kind: 'accepted', messageId: messageId(`m_${this.sent.length}`) });
  }
}

class PausingMessageSender extends RecordingMessageSender {
  readonly sending: Gate = createGate();

  readonly responded: Gate = createGate();

  override async send(message: OutgoingMessage): Promise<SendOutcome> {
    this.sending.open();
    await this.responded.opened;
    return super.send(message);
  }
}

class SecondRunObservingUnitOfWork extends InMemoryUnitOfWorkAdapter {
  private runs: number = 0;

  constructor(
    repositories: InMemoryRepositories,
    private readonly secondRunRequested: Gate,
  ) {
    super(repositories);
  }

  override run<TResult>(work: TransactionWork<TResult>): Promise<TResult> {
    this.runs += 1;
    if (this.runs === 2) {
      this.secondRunRequested.open();
    }
    return super.run(work);
  }
}

class SlowAlarmRepository extends InMemoryAlarmRepositoryAdapter {
  readonly lookingUp: Gate = createGate();

  readonly lookupReleased: Gate = createGate();

  override async findById(id: AlarmId): Promise<AlarmLookup> {
    this.lookingUp.open();
    await this.lookupReleased.opened;
    return super.findById(id);
  }
}

const defaultOptions = (): FixtureOptions => ({
  alarms: [bulkAlarm(), urgentAlarm()],
  alarmRepository: new InMemoryAlarmRepositoryAdapter(),
  permit: new StubSendPermit({ kind: 'granted' }),
  sender: new RecordingMessageSender(),
  createUnitOfWork: (repositories: InMemoryRepositories): InMemoryUnitOfWorkAdapter =>
    new InMemoryUnitOfWorkAdapter(repositories),
});

const fixture = async (
  deliveries: ReadonlyArray<Delivery>,
  overrides: Partial<FixtureOptions> = {},
): Promise<Fixture> => {
  const { alarms, alarmRepository, permit, sender, createUnitOfWork }: FixtureOptions = {
    ...defaultOptions(),
    ...overrides,
  };
  const deliveryRepository: InMemoryDeliveryRepositoryAdapter =
    new InMemoryDeliveryRepositoryAdapter();
  await Promise.all(alarms.map((alarm: Alarm): Promise<void> => alarmRepository.save(alarm)));
  await deliveryRepository.saveAll(deliveries);
  const unitOfWork: InMemoryUnitOfWorkAdapter = createUnitOfWork({
    alarmRepository,
    deliveryRepository,
    expansionJobRepository: new InMemoryExpansionJobRepositoryAdapter(),
  });
  const clock: AdjustableClock = new AdjustableClock();
  return {
    alarmRepository,
    deliveryRepository,
    unitOfWork,
    sender,
    clock,
    useCase: new SendNextDeliveryUseCase(
      unitOfWork,
      permit,
      sender,
      new FixedLeaseTokenGenerator(),
      clock,
      new FixedDispatchSettings(),
    ),
  };
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

describe('SendNextDeliveryUseCase', () => {
  it('UC-09 대기 중 Delivery 여러 건 / 발송 유스케이스 → 발송 허가를 먼저 얻고, 그 시점에 발송 가능한 건 중 우선순위가 가장 높은 1건을 claim해 바로 보내며 결과를 fencing 조건으로 기록한다', async (): Promise<void> => {
    const { deliveryRepository, sender, useCase }: Fixture = await fixture([
      pendingDelivery(1, BULK_ALARM_ID, 'BULK', CREATED_ISO),
      pendingDelivery(2, URGENT_ALARM_ID, 'URGENT', DISPATCHED_ISO),
    ]);

    const attempt: SendAttempt = await useCase.execute();

    expect(attempt).toEqual({ kind: 'sent', deliveryId: deliveryId(2) });
    expect(sender.sent).toEqual([
      {
        alarmId: URGENT_ALARM_ID,
        recipientId: 'u_000002',
        body: '10분 뒤 점검이 시작됩니다',
        clientRef: deliveryId(2),
      },
    ]);
    const [urgent]: ReadonlyArray<Delivery> = await deliveryRepository.findByAlarmId(
      alarmId(URGENT_ALARM_ID),
    );
    expect(urgent.snapshot()).toMatchObject({
      attempts: 1,
      state: { status: 'SENT', messageId: 'm_1', sentAt: at(NOW_ISO), duplicateCount: 0 },
    });
    expect(await statuses(deliveryRepository, BULK_ALARM_ID)).toEqual([['u_000001', 'PENDING']]);
  });

  it('UC-09 같은 우선순위에서는 먼저 만들어진 Delivery를 먼저 보낸다', async (): Promise<void> => {
    const { sender, useCase }: Fixture = await fixture([
      pendingDelivery(1, BULK_ALARM_ID, 'BULK', DISPATCHED_ISO),
      pendingDelivery(2, BULK_ALARM_ID, 'BULK', CREATED_ISO),
    ]);

    await useCase.execute();

    expect(sender.sent.map((message: OutgoingMessage): string => message.clientRef)).toEqual([
      deliveryId(2),
    ]);
  });

  it('UC-09 재시도 시각 전의 긴급 Delivery는 대량 Delivery의 발송을 막지 않는다', async (): Promise<void> => {
    const { sender, useCase }: Fixture = await fixture([
      retryWaitingUntil(pendingDelivery(1, URGENT_ALARM_ID, 'URGENT', CREATED_ISO), 600_000),
      pendingDelivery(2, BULK_ALARM_ID, 'BULK', CREATED_ISO),
    ]);

    await useCase.execute();

    expect(sender.sent.map((message: OutgoingMessage): string => message.clientRef)).toEqual([
      deliveryId(2),
    ]);
  });

  it('UC-09 재시도 시각이 지난 RETRY_WAIT Delivery는 다시 claim해 보낸다', async (): Promise<void> => {
    const { sender, useCase }: Fixture = await fixture([
      retryWaitingUntil(pendingDelivery(1, BULK_ALARM_ID, 'BULK', CREATED_ISO), 1_000),
    ]);

    expect(await useCase.execute()).toEqual({ kind: 'sent', deliveryId: deliveryId(1) });
    expect(sender.sent).toHaveLength(1);
  });

  it('UC-09 발송할 Delivery가 없으면 아무것도 보내지 않는다', async (): Promise<void> => {
    const { sender, useCase }: Fixture = await fixture([]);

    expect(await useCase.execute()).toEqual({ kind: 'idle' });
    expect(sender.sent).toEqual([]);
  });

  it('UC-10 발송 허가를 얻지 못했다 / 발송 유스케이스 → claim하지 않고 다음 주기를 기다린다 (claim한 채 허가를 기다리지 않는다)', async (): Promise<void> => {
    const { deliveryRepository, sender, useCase }: Fixture = await fixture(
      [pendingDelivery(1, BULK_ALARM_ID, 'BULK', CREATED_ISO)],
      { permit: new StubSendPermit({ kind: 'denied' }) },
    );

    expect(await useCase.execute()).toEqual({ kind: 'no-permit' });
    expect(sender.sent).toEqual([]);
    expect(await statuses(deliveryRepository, BULK_ALARM_ID)).toEqual([['u_000001', 'PENDING']]);
  });

  it('UC-09 취소된 알림의 대기 Delivery는 보내지 않고 CANCELLED로 정리한다', async (): Promise<void> => {
    const cancelledBulk: Alarm = transitionedAlarm(bulkAlarm().cancel(at(NOW_ISO)));
    const { deliveryRepository, sender, useCase }: Fixture = await fixture(
      [pendingDelivery(1, BULK_ALARM_ID, 'BULK', CREATED_ISO)],
      { alarms: [cancelledBulk, urgentAlarm()] },
    );

    expect(await useCase.execute()).toEqual({ kind: 'skipped', deliveryId: deliveryId(1) });
    expect(sender.sent).toEqual([]);
    expect(await statuses(deliveryRepository, BULK_ALARM_ID)).toEqual([['u_000001', 'CANCELLED']]);
  });

  it('UC-09 허가를 기다리는 동안 들어온 긴급 Delivery가 먼저 claim된다', async (): Promise<void> => {
    const permit: GatedSendPermit = new GatedSendPermit();
    const { deliveryRepository, sender, useCase }: Fixture = await fixture(
      [pendingDelivery(1, BULK_ALARM_ID, 'BULK', CREATED_ISO)],
      { permit },
    );
    const attempt: Promise<SendAttempt> = useCase.execute();
    await permit.requested.opened;

    await deliveryRepository.saveAll([pendingDelivery(2, URGENT_ALARM_ID, 'URGENT', NOW_ISO)]);
    permit.granted.open();

    expect(await attempt).toEqual({ kind: 'sent', deliveryId: deliveryId(2) });
    expect(sender.sent.map((message: OutgoingMessage): string => message.clientRef)).toEqual([
      deliveryId(2),
    ]);
  });

  it('UC-09 claim 트랜잭션을 기다리는 동안 시간이 흐르면 실제로 claim한 시각으로 lease와 요청 시작을 기록한다', async (): Promise<void> => {
    const sender: PausingMessageSender = new PausingMessageSender();
    const secondRunRequested: Gate = createGate();
    const { deliveryRepository, unitOfWork, clock, useCase }: Fixture = await fixture(
      [pendingDelivery(1, BULK_ALARM_ID, 'BULK', CREATED_ISO)],
      {
        sender,
        createUnitOfWork: (repositories: InMemoryRepositories): InMemoryUnitOfWorkAdapter =>
          new SecondRunObservingUnitOfWork(repositories, secondRunRequested),
      },
    );
    const blockerHolding: Gate = createGate();
    const blockerReleased: Gate = createGate();
    const blocker: Promise<void> = unitOfWork.run(async (): Promise<void> => {
      blockerHolding.open();
      await blockerReleased.opened;
    });
    await blockerHolding.opened;

    const attempt: Promise<SendAttempt> = useCase.execute();
    await secondRunRequested.opened;
    clock.advanceBy(70_000);
    blockerReleased.open();
    await blocker;
    await sender.sending.opened;

    const claimedAt: number = at(NOW_ISO).getTime() + 70_000;
    const [stored]: ReadonlyArray<Delivery> = await deliveryRepository.findByAlarmId(
      alarmId(BULK_ALARM_ID),
    );
    expect(stored.snapshot().state).toEqual({
      status: 'IN_FLIGHT',
      lease: { token: LEASE_TOKEN, expiresAt: new Date(claimedAt + 60_000) },
      request: { kind: 'STARTED', at: new Date(claimedAt) },
    });
    sender.responded.open();
    expect(await attempt).toEqual({ kind: 'sent', deliveryId: deliveryId(1) });
  });

  it('UC-09 claim 트랜잭션 안에서 저장소 조회가 늦어지면 조회가 끝난 시각으로 lease와 요청 시작을 기록한다', async (): Promise<void> => {
    const sender: PausingMessageSender = new PausingMessageSender();
    const alarmRepository: SlowAlarmRepository = new SlowAlarmRepository();
    const { deliveryRepository, clock, useCase }: Fixture = await fixture(
      [pendingDelivery(1, BULK_ALARM_ID, 'BULK', CREATED_ISO)],
      { sender, alarmRepository },
    );
    const attempt: Promise<SendAttempt> = useCase.execute();
    await alarmRepository.lookingUp.opened;

    clock.advanceBy(70_000);
    alarmRepository.lookupReleased.open();
    await sender.sending.opened;

    const claimedAt: number = at(NOW_ISO).getTime() + 70_000;
    const [stored]: ReadonlyArray<Delivery> = await deliveryRepository.findByAlarmId(
      alarmId(BULK_ALARM_ID),
    );
    expect(stored.snapshot().state).toEqual({
      status: 'IN_FLIGHT',
      lease: { token: LEASE_TOKEN, expiresAt: new Date(claimedAt + 60_000) },
      request: { kind: 'STARTED', at: new Date(claimedAt) },
    });
    sender.responded.open();
    expect(await attempt).toEqual({ kind: 'sent', deliveryId: deliveryId(1) });
  });

  it('UC-09 발송 응답을 기다리는 동안 다른 워커가 같은 Delivery를 이어받았으면 늦은 결과를 저장하지 않는다', async (): Promise<void> => {
    const sender: PausingMessageSender = new PausingMessageSender();
    const { deliveryRepository, useCase }: Fixture = await fixture(
      [pendingDelivery(1, BULK_ALARM_ID, 'BULK', CREATED_ISO)],
      { sender },
    );
    const attempt: Promise<SendAttempt> = useCase.execute();
    await sender.sending.opened;

    const reclaimed: Delivery = transitionedDelivery(
      pendingDelivery(1, BULK_ALARM_ID, 'BULK', CREATED_ISO).claim(
        leaseToken(PREVIOUS_TOKEN),
        at(NOW_ISO),
        durationMs(60_000),
      ),
    );
    await deliveryRepository.saveAll([reclaimed]);
    sender.responded.open();

    expect(await attempt).toEqual({ kind: 'lease-lost', deliveryId: deliveryId(1) });
    const [stored]: ReadonlyArray<Delivery> = await deliveryRepository.findByAlarmId(
      alarmId(BULK_ALARM_ID),
    );
    expect(stored.snapshot().state).toMatchObject({
      status: 'IN_FLIGHT',
      lease: { token: PREVIOUS_TOKEN },
    });
  });

  it.todo(
    'UC-11 429 응답 / 발송 유스케이스 → 공유 처리량 제한기에 Retry-After만큼 정지가 걸려 모든 워커가 함께 멈춘다',
  );
});
