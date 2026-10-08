import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
  JitterRatio,
  LeaseToken,
  MessageId,
} from '@/modules/notification/domain/delivery/delivery.type';
import { RetryPolicy } from '@/modules/notification/domain/delivery/retry-policy';
import { RetryPolicyCreation } from '@/modules/notification/domain/delivery/retry-policy.type';
import { DurationPredicates } from '@/shared/domain/duration.predicate';
import { DurationMs } from '@/shared/domain/duration.type';
import { AlarmLookup } from '@/modules/notification/application/port/out/alarm-repository.type';
import { ExpansionJobLookup } from '@/modules/notification/application/port/out/expansion-job-repository.type';
import { ClockPort } from '@/modules/notification/application/port/out/clock.port';
import { DispatchSettingsPort } from '@/modules/notification/application/port/out/dispatch-settings.port';
import { DeliveryIdGeneratorPort } from '@/modules/notification/application/port/out/delivery-id-generator.port';
import { JitterSourcePort } from '@/modules/notification/application/port/out/jitter-source.port';
import { LeaseTokenGeneratorPort } from '@/modules/notification/application/port/out/lease-token-generator.port';
import { MessageSenderPort } from '@/modules/notification/application/port/out/message-sender.port';
import {
  OutgoingMessage,
  SendOutcome,
} from '@/modules/notification/application/port/out/message-sender.type';
import { RecipientDirectoryPort } from '@/modules/notification/application/port/out/recipient-directory.port';
import {
  PageCursor,
  RecipientPage,
} from '@/modules/notification/application/port/out/recipient-directory.type';
import { SendPermitPort } from '@/modules/notification/application/port/out/send-permit.port';
import { SendPermit } from '@/modules/notification/application/port/out/send-permit.type';
import { TransactionRepositories } from '@/modules/notification/application/port/out/transaction.type';
import {
  CancelAlarmResult,
  StartDispatchResult,
} from '@/modules/notification/application/port/in/alarm-result.type';
import { CancelAlarmService } from '@/modules/notification/application/service/cancel-alarm.service';
import { ExpansionResult } from '@/modules/notification/application/port/in/expand-recipients.type';
import { ExpandRecipientsService } from '@/modules/notification/application/service/expand-recipients.service';
import { SendAttempt } from '@/modules/notification/application/port/in/send-next-delivery.type';
import { SendNextDeliveryService } from '@/modules/notification/application/service/send-next-delivery.service';
import { StartDispatchService } from '@/modules/notification/application/service/start-dispatch.service';
import { DrizzleDeliveryRepositoryAdapter } from '@/modules/notification/adapter/out/persistence/drizzle-delivery-repository.adapter';
import { DrizzleTransactionAdapter } from '@/modules/notification/adapter/out/persistence/drizzle-transaction.adapter';
import { NotificationDatabaseFactory } from '@/modules/notification/adapter/out/persistence/notification-database.factory';
import { QueryResult } from 'pg';
import { TestDatabase } from '@/shared/database/testing/test-database';

type OutcomePair = Readonly<[string, string]>;

type StartAndCancelResults = Readonly<[started: StartDispatchResult, cancelled: CancelAlarmResult]>;

interface LockWaitRow {
  readonly waiting: number;
}

interface Gate {
  readonly opened: Promise<void>;
  readonly open: () => void;
}

const NOW_ISO: string = '2026-10-08T09:00:00.000Z';

const NOT_YET_OPENED: () => void = (): void => {};

const createGate = (): Gate => {
  let release: () => void = NOT_YET_OPENED;
  const opened: Promise<void> = new Promise<void>((resolve: () => void): void => {
    release = resolve;
  });
  return { opened, open: (): void => release() };
};

const newAlarmId = (): AlarmId => {
  const value: string = randomUUID();
  if (!AlarmPredicates.isAlarmId(value)) {
    throw new Error(`generated ${value} is not a valid AlarmId`);
  }
  return value;
};

const recipientIds = (count: number): ReadonlyArray<RecipientId> =>
  Array.from({ length: count }, (_: number, index: number): RecipientId => {
    const value: string = `u_${String(index + 1).padStart(6, '0')}`;
    if (!AlarmPredicates.isRecipientId(value)) {
      throw new Error(`test fixture ${value} is not a valid RecipientId`);
    }
    return value;
  });

const durationMs = (value: number): DurationMs => {
  if (!DurationPredicates.isDurationMs(value)) {
    throw new Error(`test fixture ${value} is not a valid DurationMs`);
  }
  return value;
};

const draftAlarm = (draft: Readonly<AlarmDraft>): Alarm => {
  const creation: AlarmCreation = Alarm.create(newAlarmId(), draft, new Date(NOW_ISO));
  if (creation.kind !== 'created') {
    throw new Error(`test fixture alarm is invalid: ${creation.error.code}`);
  }
  return creation.alarm;
};

const urgentDraft = (): Alarm =>
  draftAlarm({
    title: '서버 점검',
    body: '10분 뒤 점검',
    kind: 'URGENT',
    recipientIds: ['u_000001', 'u_000002', 'u_000003'],
  });

const bulkDraft = (): Alarm =>
  draftAlarm({ title: '추석 이벤트', body: '쿠폰 도착', kind: 'BULK', recipientIds: [] });

class FixedClock implements ClockPort {
  now(): Date {
    return new Date(NOW_ISO);
  }
}

class RandomDeliveryIdGenerator implements DeliveryIdGeneratorPort {
  deliveryId(): DeliveryId {
    const value: string = randomUUID();
    if (!DeliveryPredicates.isDeliveryId(value)) {
      throw new Error(`generated ${value} is not a valid DeliveryId`);
    }
    return value;
  }
}

class RandomLeaseTokenGenerator implements LeaseTokenGeneratorPort {
  next(): LeaseToken {
    const value: string = randomUUID();
    if (!DeliveryPredicates.isLeaseToken(value)) {
      throw new Error(`generated ${value} is not a valid LeaseToken`);
    }
    return value;
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
  readonly clientRefs: Array<string> = [];

  send(message: OutgoingMessage): Promise<SendOutcome> {
    this.clientRefs.push(message.clientRef);
    const value: string = `m_${this.clientRefs.length}`;
    if (!DeliveryPredicates.isMessageId(value)) {
      throw new Error(`generated ${value} is not a valid MessageId`);
    }
    const messageId: MessageId = value;
    return Promise.resolve({ kind: 'accepted', messageId });
  }
}

class FixedDispatchSettings implements DispatchSettingsPort {
  readonly leaseMs: DurationMs = durationMs(60_000);

  readonly maxRequestMs: DurationMs = durationMs(10_000);

  readonly reconcileDelayMs: DurationMs = durationMs(35_000);

  readonly retryPolicy: RetryPolicy;

  constructor() {
    const maxAttempts: number = 3;
    if (!DeliveryPredicates.isAttemptLimit(maxAttempts)) {
      throw new Error('test fixture attempt limit is invalid');
    }
    const creation: RetryPolicyCreation = RetryPolicy.create({
      maxAttempts,
      baseDelayMs: durationMs(1_000),
      maxDelayMs: durationMs(8_000),
    });
    if (creation.kind !== 'created') {
      throw new Error(`test fixture retry policy is invalid: ${creation.error.code}`);
    }
    this.retryPolicy = creation.policy;
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

class BothWorkersFetchFirstDirectory implements RecipientDirectoryPort {
  private fetched: number = 0;

  private readonly bothFetched: Gate = createGate();

  async fetchPage(cursor: PageCursor): Promise<RecipientPage> {
    if (cursor.kind === 'first') {
      this.fetched += 1;
      if (this.fetched === 2) {
        this.bothFetched.open();
      }
      await this.bothFetched.opened;
      return { recipientIds: recipientIds(2), next: { kind: 'next', token: 'Mw' } };
    }
    return { recipientIds: [], next: { kind: 'end' } };
  }
}

const drainAll = async (useCase: SendNextDeliveryService): Promise<void> => {
  let attempt: SendAttempt = await useCase.execute();
  while (attempt.kind !== 'idle') {
    attempt = await useCase.execute();
  }
};

describe('DrizzleTransactionAdapter', () => {
  let testDatabase: TestDatabase;
  let transaction: DrizzleTransactionAdapter;

  beforeAll(async (): Promise<void> => {
    testDatabase = await TestDatabase.create();
  });

  beforeEach(async (): Promise<void> => {
    await testDatabase.pool.query('TRUNCATE alarms CASCADE');
    transaction = new DrizzleTransactionAdapter(
      NotificationDatabaseFactory.create(testDatabase.pool),
    );
  });

  afterAll(async (): Promise<void> => {
    await testDatabase.drop();
  });

  const save = (alarm: Alarm): Promise<void> =>
    transaction.run(({ alarmRepository }: TransactionRepositories): Promise<void> =>
      alarmRepository.save(alarm),
    );

  const storedStatus = async (id: AlarmId): Promise<string> => {
    const lookup: AlarmLookup = await transaction.run(
      ({ alarmRepository }: TransactionRepositories): Promise<AlarmLookup> =>
        alarmRepository.findById(id),
    );
    return lookup.kind === 'found' ? lookup.alarm.snapshot().state.status : 'missing';
  };

  const deliveriesOf = (id: AlarmId): Promise<ReadonlyArray<Delivery>> =>
    new DrizzleDeliveryRepositoryAdapter(
      NotificationDatabaseFactory.create(testDatabase.pool),
    ).findByAlarmId(id);

  const waitUntilAnotherTransactionWaitsForLock = (): Promise<void> =>
    vi.waitFor(
      async (): Promise<void> => {
        const { rows }: Readonly<QueryResult<LockWaitRow>> =
          await testDatabase.pool.query<LockWaitRow>(
            "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
          );
        const [{ waiting }]: ReadonlyArray<LockWaitRow> = rows;
        expect(waiting).toBe(1);
      },
      { timeout: 2_000, interval: 10 },
    );

  const startDispatch = (): StartDispatchService =>
    new StartDispatchService(transaction, new RandomDeliveryIdGenerator(), new FixedClock());

  it('DB-15 알림 상태 변경과 Delivery 생성을 한 트랜잭션에서 진행 중 / 트랜잭션 도중 실패한다 → 알림 상태 변경과 Delivery 생성이 함께 롤백된다', async (): Promise<void> => {
    const alarm: Alarm = urgentDraft();
    await save(alarm);
    const dispatchedTransition: AlarmTransition = alarm.startDispatch(new Date(NOW_ISO));
    if (dispatchedTransition.kind !== 'transitioned') {
      throw new Error('test fixture alarm cannot be dispatched');
    }
    const { id }: ReturnType<Alarm['snapshot']> = alarm.snapshot();

    await expect(
      transaction.run(
        async ({ alarmRepository, deliveryCreation }: TransactionRepositories): Promise<void> => {
          await alarmRepository.save(dispatchedTransition.alarm);
          await deliveryCreation.insertMissing(
            recipientIds(2).map((recipientId: RecipientId): Delivery =>
              Delivery.create(
                {
                  id: new RandomDeliveryIdGenerator().deliveryId(),
                  alarmId: id,
                  recipientId,
                  priority: 'URGENT',
                },
                new Date(NOW_ISO),
              ),
            ),
          );
          throw new Error('failure in the middle of the transaction');
        },
      ),
    ).rejects.toThrow('failure in the middle of the transaction');
    expect(await storedStatus(id)).toBe('DRAFT');
    expect(await deliveriesOf(id)).toEqual([]);
  });

  it('DB-15 대량 알림 상태 변경과 확장 작업 생성을 한 트랜잭션에서 진행 중 / 트랜잭션 도중 실패한다 → 알림 상태 변경과 확장 작업 생성이 함께 롤백된다', async (): Promise<void> => {
    const alarm: Alarm = bulkDraft();
    await save(alarm);
    const dispatchedTransition: AlarmTransition = alarm.startDispatch(new Date(NOW_ISO));
    if (dispatchedTransition.kind !== 'transitioned') {
      throw new Error('test fixture alarm cannot be dispatched');
    }
    const { id }: ReturnType<Alarm['snapshot']> = alarm.snapshot();

    await expect(
      transaction.run(
        async ({
          alarmRepository,
          expansionJobRepository,
        }: TransactionRepositories): Promise<void> => {
          await alarmRepository.save(dispatchedTransition.alarm);
          await expansionJobRepository.enqueue(id, new Date(NOW_ISO));
          throw new Error('failure in the middle of the transaction');
        },
      ),
    ).rejects.toThrow('failure in the middle of the transaction');
    expect(await storedStatus(id)).toBe('DRAFT');
    expect(
      await transaction.run(
        ({ expansionJobRepository }: TransactionRepositories): Promise<ExpansionJobLookup> =>
          expansionJobRepository.findByAlarmId(id),
      ),
    ).toEqual({ kind: 'missing' });
  });

  it('DB-04 같은 DRAFT 알림 / 발송 시작 요청 두 개가 동시에 들어온다 → 하나만 성공하고 나머지는 상태 충돌이 난다', async (): Promise<void> => {
    const alarm: Alarm = urgentDraft();
    await save(alarm);
    const { id }: ReturnType<Alarm['snapshot']> = alarm.snapshot();

    const results: ReadonlyArray<StartDispatchResult> = await Promise.all([
      startDispatch().execute(id),
      startDispatch().execute(id),
    ]);

    expect(results.map((result: StartDispatchResult): string => result.kind).toSorted()).toEqual([
      'conflict',
      'dispatched',
    ]);
    expect(await deliveriesOf(id)).toHaveLength(3);
  });

  it('DB-04 같은 대량 DRAFT 알림의 발송 시작이 동시에 두 번 들어와도 하나만 성공한다', async (): Promise<void> => {
    const alarm: Alarm = bulkDraft();
    await save(alarm);
    const { id }: ReturnType<Alarm['snapshot']> = alarm.snapshot();

    const results: ReadonlyArray<StartDispatchResult> = await Promise.all([
      startDispatch().execute(id),
      startDispatch().execute(id),
    ]);

    expect(results.map((result: StartDispatchResult): string => result.kind).toSorted()).toEqual([
      'conflict',
      'dispatched',
    ]);
  });

  it('DB-05 DRAFT 알림 / 발송 시작과 취소가 동시에 들어온다 → 최종 상태와 각 요청의 성공·실패가 어떤 직렬 실행 순서의 결과와 일치한다', async (): Promise<void> => {
    const alarm: Alarm = urgentDraft();
    await save(alarm);
    const { id }: ReturnType<Alarm['snapshot']> = alarm.snapshot();

    const [started, cancelled]: StartAndCancelResults = await Promise.all([
      startDispatch().execute(id),
      new CancelAlarmService(transaction, new FixedClock()).execute(id),
    ]);
    const outcome: OutcomePair = [started.kind, cancelled.kind];
    const deliveryStatuses: ReadonlyArray<string> = (await deliveriesOf(id)).map(
      (delivery: Delivery): string => delivery.snapshot().state.status,
    );

    expect(await storedStatus(id)).toBe('CANCELLED');
    expect([
      ['dispatched', 'cancelled'],
      ['conflict', 'cancelled'],
    ]).toContainEqual(outcome);
    expect(deliveryStatuses.every((status: string): boolean => status === 'CANCELLED')).toBe(true);
  });

  it('DB-06 대기 Delivery 100건 / 워커 3개가 동시에 claim한다 (FOR UPDATE SKIP LOCKED) → 같은 Delivery를 두 워커가 가져가지 않는다', async (): Promise<void> => {
    const alarm: Alarm = bulkDraft();
    const dispatchedTransition: AlarmTransition = alarm.startDispatch(new Date(NOW_ISO));
    if (dispatchedTransition.kind !== 'transitioned') {
      throw new Error('test fixture alarm cannot be dispatched');
    }
    await save(dispatchedTransition.alarm);
    const { id }: ReturnType<Alarm['snapshot']> = alarm.snapshot();
    await transaction.run(({ deliveryCreation }: TransactionRepositories): Promise<void> =>
      deliveryCreation.insertMissing(
        recipientIds(100).map((recipientId: RecipientId): Delivery =>
          Delivery.create(
            {
              id: new RandomDeliveryIdGenerator().deliveryId(),
              alarmId: id,
              recipientId,
              priority: 'BULK',
            },
            new Date(NOW_ISO),
          ),
        ),
      ),
    );
    const sender: RecordingMessageSender = new RecordingMessageSender();
    const worker = (): SendNextDeliveryService =>
      new SendNextDeliveryService(
        transaction,
        new AlwaysGrantedPermit(),
        sender,
        new RandomLeaseTokenGenerator(),
        new FixedClock(),
        new FixedDispatchSettings(),
        new ZeroJitter(),
      );
    await Promise.all([drainAll(worker()), drainAll(worker()), drainAll(worker())]);

    expect(sender.clientRefs).toHaveLength(100);
    expect(new Set<string>(sender.clientRefs).size).toBe(100);
    expect(
      (await deliveriesOf(id)).every(
        (delivery: Delivery): boolean => delivery.snapshot().state.status === 'SENT',
      ),
    ).toBe(true);
  });

  it('UC-07 두 워커가 같은 확장 페이지를 받아 동시에 저장하면 한 워커만 진행하고 다른 워커는 superseded가 된다', async (): Promise<void> => {
    const alarm: Alarm = bulkDraft();
    await save(alarm);
    const { id }: ReturnType<Alarm['snapshot']> = alarm.snapshot();
    await startDispatch().execute(id);
    const directory: BothWorkersFetchFirstDirectory = new BothWorkersFetchFirstDirectory();
    const expander = (): ExpandRecipientsService =>
      new ExpandRecipientsService(
        transaction,
        directory,
        new RandomDeliveryIdGenerator(),
        new FixedClock(),
      );

    const results: ReadonlyArray<ExpansionResult> = await Promise.all([
      expander().execute(id),
      expander().execute(id),
    ]);

    expect(results.map((result: ExpansionResult): string => result.kind).toSorted()).toEqual([
      'completed',
      'superseded',
    ]);
    expect(await deliveriesOf(id)).toHaveLength(2);
  });

  it('DB-04 알림을 잠그며 읽은 트랜잭션이 있으면 다른 트랜잭션의 잠금 조회는 커밋을 기다렸다가 바뀐 상태를 읽는다', async (): Promise<void> => {
    const alarm: Alarm = bulkDraft();
    await save(alarm);
    const { id }: ReturnType<Alarm['snapshot']> = alarm.snapshot();
    const locked: Gate = createGate();
    const release: Gate = createGate();
    const holder: Promise<void> = transaction.run(
      async ({ alarmRepository }: TransactionRepositories): Promise<void> => {
        await alarmRepository.findByIdForUpdate(id);
        locked.open();
        await release.opened;
        const cancelled: AlarmTransition = alarm.cancel(new Date(NOW_ISO));
        if (cancelled.kind !== 'transitioned') {
          throw new Error(`test fixture alarm cannot be cancelled: ${cancelled.kind}`);
        }
        await alarmRepository.save(cancelled.alarm);
      },
    );
    await locked.opened;

    const waiter: Promise<AlarmLookup> = transaction.run(
      ({ alarmRepository }: TransactionRepositories): Promise<AlarmLookup> =>
        alarmRepository.findByIdForUpdate(id),
    );
    try {
      await waitUntilAnotherTransactionWaitsForLock();
    } finally {
      release.open();
      await Promise.allSettled([holder, waiter]);
    }

    const lookup: AlarmLookup = await waiter;
    expect(lookup.kind === 'found' ? lookup.alarm.snapshot().state.status : 'missing').toBe(
      'CANCELLED',
    );
  });

  it('UC-07 확장 작업을 잠그며 읽은 트랜잭션이 있으면 다른 트랜잭션의 잠금 조회는 커밋을 기다렸다가 바뀐 진행을 읽는다', async (): Promise<void> => {
    const alarm: Alarm = bulkDraft();
    await save(alarm);
    const { id }: ReturnType<Alarm['snapshot']> = alarm.snapshot();
    await transaction.run(({ expansionJobRepository }: TransactionRepositories): Promise<void> =>
      expansionJobRepository.enqueue(id, new Date(NOW_ISO)),
    );
    const locked: Gate = createGate();
    const release: Gate = createGate();
    const holder: Promise<void> = transaction.run(
      async ({ expansionJobRepository }: TransactionRepositories): Promise<void> => {
        await expansionJobRepository.findByAlarmIdForUpdate(id);
        locked.open();
        await release.opened;
        await expansionJobRepository.recordProgress(id, {
          kind: 'completed',
          completedAt: new Date(NOW_ISO),
        });
      },
    );
    await locked.opened;

    const waiter: Promise<ExpansionJobLookup> = transaction.run(
      ({ expansionJobRepository }: TransactionRepositories): Promise<ExpansionJobLookup> =>
        expansionJobRepository.findByAlarmIdForUpdate(id),
    );
    try {
      await waitUntilAnotherTransactionWaitsForLock();
    } finally {
      release.open();
      await Promise.allSettled([holder, waiter]);
    }

    expect(await waiter).toMatchObject({ kind: 'found', job: { progress: { kind: 'completed' } } });
  });
});
