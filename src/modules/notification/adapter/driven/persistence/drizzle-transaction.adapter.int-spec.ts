import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkerShutdownSignalAdapter } from '@/modules/notification/adapter/driven/process-state/worker-shutdown-signal.adapter';
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
  DeliveryStatusCounts,
  JitterRatio,
  LeaseToken,
  MessageId,
} from '@/modules/notification/domain/delivery/delivery.type';
import { RetryPolicy } from '@/modules/notification/domain/delivery/retry-policy';
import { RetryPolicyCreation } from '@/modules/notification/domain/delivery/retry-policy.type';
import { DurationPredicates } from '@/shared/domain/duration.predicate';
import { DurationMs } from '@/shared/domain/duration.type';
import { AlarmLookup } from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.type';
import { ExpansionJobLookup } from '@/modules/notification/application/port/driven/for-storing-expansion-jobs/expansion-job-repository.type';
import { ClockPort } from '@/modules/notification/application/port/driven/for-telling-time/clock.port';
import { DispatchSettings } from '@/modules/notification/application/service/delivery/delivery-settings.type';
import { ExpansionSettings } from '@/modules/notification/application/service/expansion/expansion-settings.type';
import { DeliveryIdGeneratorPort } from '@/modules/notification/application/port/driven/for-generating-ids/delivery-id-generator.port';
import { JitterSourcePort } from '@/modules/notification/application/port/driven/for-drawing-jitter/jitter-source.port';
import { LeaseTokenGeneratorPort } from '@/modules/notification/application/port/driven/for-generating-ids/lease-token-generator.port';
import { MessageSenderPort } from '@/modules/notification/application/port/driven/for-sending-messages/message-sender.port';
import {
  OutgoingMessage,
  SendOutcome,
} from '@/modules/notification/application/port/driven/for-sending-messages/message-sender.type';
import { RecipientDirectoryPort } from '@/modules/notification/application/port/driven/for-fetching-recipients/recipient-directory.port';
import {
  PageCursor,
  RecipientPage,
} from '@/modules/notification/application/port/driven/for-fetching-recipients/recipient-directory.type';
import { SendPermitPort } from '@/modules/notification/application/port/driven/for-permitting-sends/send-permit.port';
import { SendPermit } from '@/modules/notification/application/port/driven/for-permitting-sends/send-permit.type';
import {
  SnapshotRepositories,
  TransactionRepositories,
} from '@/modules/notification/application/port/driven/for-running-transactions/transaction.type';
import {
  CancelAlarmResult,
  StartDispatchResult,
} from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-result.type';
import { CancelAlarmService } from '@/modules/notification/application/service/alarm/cancel-alarm.service';
import { ExpansionPageAttempt } from '@/modules/notification/application/port/driving/for-dispatching-alarms/expand-next-page.type';
import { ExpandNextPageService } from '@/modules/notification/application/service/expansion/expand-next-page.service';
import { SendAttempt } from '@/modules/notification/application/port/driving/for-dispatching-alarms/send-next-delivery.type';
import { SendNextDeliveryService } from '@/modules/notification/application/service/delivery/send-next-delivery.service';
import { StartDispatchService } from '@/modules/notification/application/service/alarm/start-dispatch.service';
import { DrizzleDeliveryRepositoryAdapter } from '@/modules/notification/adapter/driven/persistence/delivery/drizzle-delivery-repository.adapter';
import { DrizzleTransactionAdapter } from '@/modules/notification/adapter/driven/persistence/drizzle-transaction.adapter';
import { NotificationDatabaseFactory } from '@/modules/notification/adapter/driven/persistence/notification-database.factory';
import { QueryResult } from 'pg';
import { TestDatabase } from '@/shared/database/testing/test-database';

type OutcomePair = Readonly<[string, string]>;

type StartAndCancelResults = Readonly<[started: StartDispatchResult, cancelled: CancelAlarmResult]>;

type CancelCounts = Readonly<
  [beforeCancel: DeliveryStatusCounts, afterCancel: DeliveryStatusCounts]
>;

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
  const rawAlarmId: string = randomUUID();
  if (!AlarmPredicates.isAlarmId(rawAlarmId)) {
    throw new Error(`generated ${rawAlarmId} is not a valid AlarmId`);
  }
  return rawAlarmId;
};

const recipientIds = (count: number): ReadonlyArray<RecipientId> =>
  Array.from({ length: count }, (_: number, index: number): RecipientId => {
    const rawRecipientId: string = `u_${String(index + 1).padStart(6, '0')}`;
    if (!AlarmPredicates.isRecipientId(rawRecipientId)) {
      throw new Error(`test fixture ${rawRecipientId} is not a valid RecipientId`);
    }
    return rawRecipientId;
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
  constructor(private readonly fixedIso: string = NOW_ISO) {}

  now(): Date {
    return new Date(this.fixedIso);
  }
}

const EXPANSION_LEASE_MS: number = 30_000;

const AFTER_EXPANSION_LEASE_ISO: string = '2026-10-08T09:00:31.000Z';

class FixedExpansionSettings implements ExpansionSettings {
  readonly leaseMs: DurationMs = durationMs(EXPANSION_LEASE_MS);
}

class RandomDeliveryIdGenerator implements DeliveryIdGeneratorPort {
  deliveryId(): DeliveryId {
    const rawDeliveryId: string = randomUUID();
    if (!DeliveryPredicates.isDeliveryId(rawDeliveryId)) {
      throw new Error(`generated ${rawDeliveryId} is not a valid DeliveryId`);
    }
    return rawDeliveryId;
  }
}

class RandomLeaseTokenGenerator implements LeaseTokenGeneratorPort {
  next(): LeaseToken {
    const rawLeaseToken: string = randomUUID();
    if (!DeliveryPredicates.isLeaseToken(rawLeaseToken)) {
      throw new Error(`generated ${rawLeaseToken} is not a valid LeaseToken`);
    }
    return rawLeaseToken;
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
    const rawMessageId: string = `m_${this.clientRefs.length}`;
    if (!DeliveryPredicates.isMessageId(rawMessageId)) {
      throw new Error(`generated ${rawMessageId} is not a valid MessageId`);
    }
    const messageId: MessageId = rawMessageId;
    return Promise.resolve({ kind: 'accepted', messageId });
  }
}

class FixedDispatchSettings implements DispatchSettings {
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
  readonly firstFetchStarted: Gate = createGate();

  private fetched: number = 0;

  private readonly bothFetched: Gate = createGate();

  async fetchPage(cursor: PageCursor): Promise<RecipientPage> {
    if (cursor.kind === 'first') {
      this.fetched += 1;
      this.firstFetchStarted.open();
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

  const countsAroundConcurrentCancel = async (alarmId: AlarmId): Promise<CancelCounts> => {
    const beforeCancel: DeliveryStatusCounts = await deliveryProgressOf(alarmId);
    await new CancelAlarmService(transaction, new FixedClock()).execute({ alarmId });
    return [beforeCancel, await deliveryProgressOf(alarmId)];
  };

  const deliveryProgressOf = (alarmId: AlarmId): Promise<DeliveryStatusCounts> =>
    new DrizzleDeliveryRepositoryAdapter(
      NotificationDatabaseFactory.create(testDatabase.pool),
    ).countByStatus(alarmId);

  const dispatchedUrgentAlarm = async (): Promise<AlarmId> => {
    const alarm: Alarm = urgentDraft();
    await save(alarm);
    const { id: alarmId }: ReturnType<Alarm['snapshot']> = alarm.snapshot();
    await startDispatch().execute({ alarmId });
    return alarmId;
  };

  it('DB-17 발송 중인 알림 / 한 스냅샷 안에서 상태별 Delivery 수를 두 번 읽는 사이에 다른 트랜잭션이 Delivery를 바꿔 커밋한다 → 스냅샷 안의 두 조회는 같은 시점의 값을 본다', async (): Promise<void> => {
    const alarmId: AlarmId = await dispatchedUrgentAlarm();

    const [beforeCancel, afterCancel]: CancelCounts = await transaction.readSnapshot(
      async ({ deliveryRepository }: SnapshotRepositories): Promise<CancelCounts> => {
        const countedBeforeCancel: DeliveryStatusCounts =
          await deliveryRepository.countByStatus(alarmId);
        await new CancelAlarmService(transaction, new FixedClock()).execute({ alarmId });
        return [countedBeforeCancel, await deliveryRepository.countByStatus(alarmId)];
      },
    );

    expect(beforeCancel).toMatchObject({ PENDING: 3, CANCELLED: 0 });
    expect(afterCancel).toEqual(beforeCancel);
    expect(await deliveryProgressOf(alarmId)).toMatchObject({ PENDING: 0, CANCELLED: 3 });
  });

  it('DB-17 스냅샷 없이 읽으면 두 조회 사이에 커밋된 변경이 보인다 (READ COMMITTED 대조)', async (): Promise<void> => {
    const alarmId: AlarmId = await dispatchedUrgentAlarm();

    const [beforeCancel, afterCancel]: CancelCounts = await countsAroundConcurrentCancel(alarmId);

    expect(beforeCancel).toMatchObject({ PENDING: 3, CANCELLED: 0 });
    expect(afterCancel).toMatchObject({ PENDING: 0, CANCELLED: 3 });
  });

  it('DB-15 알림 상태 변경과 Delivery 생성을 한 트랜잭션에서 진행 중 / 트랜잭션 도중 실패한다 → 알림 상태 변경과 Delivery 생성이 함께 롤백된다', async (): Promise<void> => {
    const alarm: Alarm = urgentDraft();
    await save(alarm);
    const dispatchedTransition: AlarmTransition = alarm.startDispatch(new Date(NOW_ISO));
    if (dispatchedTransition.kind !== 'transitioned') {
      throw new Error('test fixture alarm cannot be dispatched');
    }
    const { id: alarmId }: ReturnType<Alarm['snapshot']> = alarm.snapshot();

    await expect(
      transaction.run(
        async ({ alarmRepository, deliveryRepository }: TransactionRepositories): Promise<void> => {
          await alarmRepository.save(dispatchedTransition.alarm);
          await deliveryRepository.insertMissing(
            recipientIds(2).map((recipientId: RecipientId): Delivery =>
              Delivery.create(
                {
                  id: new RandomDeliveryIdGenerator().deliveryId(),
                  alarmId,
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
    expect(await storedStatus(alarmId)).toBe('DRAFT');
    expect(await deliveriesOf(alarmId)).toEqual([]);
  });

  it('DB-15 대량 알림 상태 변경과 확장 작업 생성을 한 트랜잭션에서 진행 중 / 트랜잭션 도중 실패한다 → 알림 상태 변경과 확장 작업 생성이 함께 롤백된다', async (): Promise<void> => {
    const alarm: Alarm = bulkDraft();
    await save(alarm);
    const dispatchedTransition: AlarmTransition = alarm.startDispatch(new Date(NOW_ISO));
    if (dispatchedTransition.kind !== 'transitioned') {
      throw new Error('test fixture alarm cannot be dispatched');
    }
    const { id: alarmId }: ReturnType<Alarm['snapshot']> = alarm.snapshot();

    await expect(
      transaction.run(
        async ({
          alarmRepository,
          expansionJobRepository,
        }: TransactionRepositories): Promise<void> => {
          await alarmRepository.save(dispatchedTransition.alarm);
          await expansionJobRepository.enqueue(alarmId, new Date(NOW_ISO));
          throw new Error('failure in the middle of the transaction');
        },
      ),
    ).rejects.toThrow('failure in the middle of the transaction');
    expect(await storedStatus(alarmId)).toBe('DRAFT');
    expect(
      await transaction.run(
        ({ expansionJobRepository }: TransactionRepositories): Promise<ExpansionJobLookup> =>
          expansionJobRepository.findByAlarmId(alarmId),
      ),
    ).toEqual({ kind: 'missing' });
  });

  it('DB-04 같은 DRAFT 알림 / 발송 시작 요청 두 개가 동시에 들어온다 → 하나만 성공하고 나머지는 상태 충돌이 난다', async (): Promise<void> => {
    const alarm: Alarm = urgentDraft();
    await save(alarm);
    const { id: alarmId }: ReturnType<Alarm['snapshot']> = alarm.snapshot();

    const results: ReadonlyArray<StartDispatchResult> = await Promise.all([
      startDispatch().execute({ alarmId }),
      startDispatch().execute({ alarmId }),
    ]);

    expect(results.map((result: StartDispatchResult): string => result.kind).toSorted()).toEqual([
      'conflict',
      'dispatched',
    ]);
    expect(await deliveriesOf(alarmId)).toHaveLength(3);
  });

  it('DB-04 같은 대량 DRAFT 알림의 발송 시작이 동시에 두 번 들어와도 하나만 성공한다', async (): Promise<void> => {
    const alarm: Alarm = bulkDraft();
    await save(alarm);
    const { id: alarmId }: ReturnType<Alarm['snapshot']> = alarm.snapshot();

    const results: ReadonlyArray<StartDispatchResult> = await Promise.all([
      startDispatch().execute({ alarmId }),
      startDispatch().execute({ alarmId }),
    ]);

    expect(results.map((result: StartDispatchResult): string => result.kind).toSorted()).toEqual([
      'conflict',
      'dispatched',
    ]);
  });

  it('DB-05 DRAFT 알림 / 발송 시작과 취소가 동시에 들어온다 → 최종 상태와 각 요청의 성공·실패가 어떤 직렬 실행 순서의 결과와 일치한다', async (): Promise<void> => {
    const alarm: Alarm = urgentDraft();
    await save(alarm);
    const { id: alarmId }: ReturnType<Alarm['snapshot']> = alarm.snapshot();

    const [started, cancelled]: StartAndCancelResults = await Promise.all([
      startDispatch().execute({ alarmId }),
      new CancelAlarmService(transaction, new FixedClock()).execute({ alarmId }),
    ]);
    const outcome: OutcomePair = [started.kind, cancelled.kind];
    const deliveryStatuses: ReadonlyArray<string> = (await deliveriesOf(alarmId)).map(
      (delivery: Delivery): string => delivery.snapshot().state.status,
    );

    expect(await storedStatus(alarmId)).toBe('CANCELLED');
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
    const { id: alarmId }: ReturnType<Alarm['snapshot']> = alarm.snapshot();
    await transaction.run(({ deliveryRepository }: TransactionRepositories): Promise<void> =>
      deliveryRepository.insertMissing(
        recipientIds(100).map((recipientId: RecipientId): Delivery =>
          Delivery.create(
            {
              id: new RandomDeliveryIdGenerator().deliveryId(),
              alarmId,
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
        new WorkerShutdownSignalAdapter(),
      );
    await Promise.all([drainAll(worker()), drainAll(worker()), drainAll(worker())]);

    expect(sender.clientRefs).toHaveLength(100);
    expect(new Set<string>(sender.clientRefs).size).toBe(100);
    expect(
      (await deliveriesOf(alarmId)).every(
        (delivery: Delivery): boolean => delivery.snapshot().state.status === 'SENT',
      ),
    ).toBe(true);
  });

  it('UC-07 lease가 만료돼 두 워커가 같은 확장 페이지를 받아 동시에 저장하면 한 워커만 진행하고 다른 워커는 superseded가 된다', async (): Promise<void> => {
    const alarm: Alarm = bulkDraft();
    await save(alarm);
    const { id: alarmId }: ReturnType<Alarm['snapshot']> = alarm.snapshot();
    await startDispatch().execute({ alarmId });
    const directory: BothWorkersFetchFirstDirectory = new BothWorkersFetchFirstDirectory();
    const expanderAt = (clockIso: string): ExpandNextPageService =>
      new ExpandNextPageService(
        transaction,
        directory,
        new RandomDeliveryIdGenerator(),
        new FixedExpansionSettings(),
        new FixedClock(clockIso),
      );

    const leaseHolderAttempt: Promise<ExpansionPageAttempt> = expanderAt(NOW_ISO).execute();
    await directory.firstFetchStarted.opened;
    const takeoverAttempt: Promise<ExpansionPageAttempt> =
      expanderAt(AFTER_EXPANSION_LEASE_ISO).execute();
    const attempts: ReadonlyArray<ExpansionPageAttempt> = await Promise.all([
      leaseHolderAttempt,
      takeoverAttempt,
    ]);

    expect(
      attempts
        .map((attempt: ExpansionPageAttempt): string =>
          attempt.kind === 'expanded' ? attempt.step : attempt.kind,
        )
        .toSorted(),
    ).toEqual(['continued', 'superseded']);
    expect(await deliveriesOf(alarmId)).toHaveLength(2);
  });

  it('DB-04 알림을 잠그며 읽은 트랜잭션이 있으면 다른 트랜잭션의 잠금 조회는 커밋을 기다렸다가 바뀐 상태를 읽는다', async (): Promise<void> => {
    const alarm: Alarm = bulkDraft();
    await save(alarm);
    const { id: alarmId }: ReturnType<Alarm['snapshot']> = alarm.snapshot();
    const locked: Gate = createGate();
    const release: Gate = createGate();
    const holder: Promise<void> = transaction.run(
      async ({ alarmRepository }: TransactionRepositories): Promise<void> => {
        await alarmRepository.findByIdForUpdate(alarmId);
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
        alarmRepository.findByIdForUpdate(alarmId),
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
    const { id: alarmId }: ReturnType<Alarm['snapshot']> = alarm.snapshot();
    await transaction.run(({ expansionJobRepository }: TransactionRepositories): Promise<void> =>
      expansionJobRepository.enqueue(alarmId, new Date(NOW_ISO)),
    );
    const locked: Gate = createGate();
    const release: Gate = createGate();
    const holder: Promise<void> = transaction.run(
      async ({ expansionJobRepository }: TransactionRepositories): Promise<void> => {
        await expansionJobRepository.findByAlarmIdForUpdate(alarmId);
        locked.open();
        await release.opened;
        await expansionJobRepository.recordProgress(alarmId, {
          kind: 'completed',
          completedAt: new Date(NOW_ISO),
        });
      },
    );
    await locked.opened;

    const waiter: Promise<ExpansionJobLookup> = transaction.run(
      ({ expansionJobRepository }: TransactionRepositories): Promise<ExpansionJobLookup> =>
        expansionJobRepository.findByAlarmIdForUpdate(alarmId),
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
