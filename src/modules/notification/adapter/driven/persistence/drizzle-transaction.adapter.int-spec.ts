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
  DeliveryPriority,
  DeliveryStatusCounts,
  JitterRatio,
  LeaseToken,
  MessageId,
} from '@/modules/notification/domain/delivery/delivery.type';
import { RetryPolicy } from '@/modules/notification/domain/delivery/retry-policy';
import { ExpansionJob } from '@/modules/notification/domain/expansion/expansion-job.entity';
import { RetryPolicyCreation } from '@/modules/notification/domain/delivery/retry-policy.type';
import { DurationPredicates } from '@/shared/domain/duration.predicate';
import { DurationMs } from '@/shared/domain/duration.type';
import { DeliveryCandidate } from '@/modules/notification/application/port/driven/for-storing-deliveries/delivery-repository.type';
import { AlarmLookup } from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.type';
import { ExpansionJobLookup } from '@/modules/notification/application/port/driven/for-storing-expansion-jobs/expansion-job-repository.type';
import { ClockPort } from '@/modules/notification/application/port/driven/for-telling-time/clock.port';
import {
  DispatchSettings,
  ReconcileSettings,
} from '@/modules/notification/application/service/delivery/delivery-settings.type';
import { ExpansionSettings } from '@/modules/notification/application/service/expansion/expansion-settings.type';
import { IdGeneratorPort } from '@/modules/notification/application/port/driven/for-generating-ids/id-generator.port';
import { JitterSourcePort } from '@/modules/notification/application/port/driven/for-drawing-jitter/jitter-source.port';
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
import { MessageLookupPort } from '@/modules/notification/application/port/driven/for-looking-up-messages/message-lookup.port';
import { MessageLookupResult } from '@/modules/notification/application/port/driven/for-looking-up-messages/message-lookup.type';
import { SendPermitPort } from '@/modules/notification/application/port/driven/for-permitting-sends/send-permit.port';
import { SendPermit } from '@/modules/notification/application/port/driven/for-permitting-sends/send-permit.type';
import { TransactionPort } from '@/modules/notification/application/port/driven/for-running-transactions/transaction.port';
import {
  SnapshotRepositories,
  SnapshotWork,
  TransactionRepositories,
  TransactionWork,
} from '@/modules/notification/application/port/driven/for-running-transactions/transaction.type';
import { CancelAlarmResult } from '@/modules/notification/application/port/driving/for-managing-alarms/cancel-alarm.type';
import { StartDispatchResult } from '@/modules/notification/application/port/driving/for-managing-alarms/start-dispatch.type';
import { CancelAlarmService } from '@/modules/notification/application/service/alarm/cancel-alarm.service';
import { ExpansionPageAttempt } from '@/modules/notification/application/port/driving/for-dispatching-alarms/expand-next-page.type';
import { ExpandNextPageService } from '@/modules/notification/application/service/expansion/expand-next-page.service';
import { SendAttempt } from '@/modules/notification/application/port/driving/for-dispatching-alarms/send-next-delivery.type';
import { SendNextDeliveryService } from '@/modules/notification/application/service/delivery/send-next-delivery.service';
import { ReconcileAttempt } from '@/modules/notification/application/port/driving/for-dispatching-alarms/reconcile-next-delivery.type';
import { ReconcileNextDeliveryService } from '@/modules/notification/application/service/delivery/reconcile-next-delivery.service';
import { StartDispatchService } from '@/modules/notification/application/service/alarm/start-dispatch.service';
import { DrizzleDeliveryRepositoryAdapter } from '@/modules/notification/adapter/driven/persistence/delivery/drizzle-delivery-repository.adapter';
import { DrizzleTransactionAdapter } from '@/modules/notification/adapter/driven/persistence/drizzle-transaction.adapter';
import { NotificationDatabaseFactory } from '@/modules/notification/adapter/driven/persistence/notification-database.factory';
import { QueryResult } from 'pg';
import { createGate, Gate } from '@/shared/testing/gate.factory';
import { KindAssertion, KindMember } from '@/shared/testing/kind.assertion';
import { TestDatabase } from '@/shared/database/testing/test-database.helper';

type OutcomePair = Readonly<[string, string]>;

type StartAndCancelResults = Readonly<[started: StartDispatchResult, cancelled: CancelAlarmResult]>;

type CancelCounts = Readonly<
  [beforeCancel: DeliveryStatusCounts, afterCancel: DeliveryStatusCounts]
>;

interface LockWaitRow {
  readonly waiting: number;
}

const NOW_ISO: string = '2026-10-08T09:00:00.000Z';

const RECONCILE_DUE_ISO: string = '2026-10-08T09:00:36.000Z';

const SAVED_WITHOUT_WAITING: string = 'saved-without-waiting';

const WAITED_FOR_CANCEL_COMMIT: string = 'waited-for-cancel-commit';

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
  KindAssertion.assertKind(creation, 'created');
  const { alarm }: KindMember<AlarmCreation, 'created'> = creation;
  return alarm;
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

class RandomDeliveryIdGenerator implements Pick<IdGeneratorPort, 'deliveryId'> {
  deliveryId(): DeliveryId {
    const rawDeliveryId: string = randomUUID();
    if (!DeliveryPredicates.isDeliveryId(rawDeliveryId)) {
      throw new Error(`generated ${rawDeliveryId} is not a valid DeliveryId`);
    }
    return rawDeliveryId;
  }
}

class RandomLeaseTokenGenerator implements Pick<IdGeneratorPort, 'leaseToken'> {
  leaseToken(): LeaseToken {
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

  constructor(private readonly workerName: string) {}

  send(message: OutgoingMessage): Promise<SendOutcome> {
    this.clientRefs.push(message.clientRef);
    const rawMessageId: string = `m_${this.workerName}_${this.clientRefs.length}`;
    if (!DeliveryPredicates.isMessageId(rawMessageId)) {
      throw new Error(`generated ${rawMessageId} is not a valid MessageId`);
    }
    const messageId: MessageId = rawMessageId;
    return Promise.resolve({ kind: 'accepted', messageId });
  }
}

const threeAttemptRetryPolicy = (): RetryPolicy => {
  const maxAttempts: number = 3;
  if (!DeliveryPredicates.isAttemptLimit(maxAttempts)) {
    throw new Error('test fixture attempt limit is invalid');
  }
  const creation: RetryPolicyCreation = RetryPolicy.create({
    maxAttempts,
    baseDelayMs: durationMs(1_000),
    maxDelayMs: durationMs(8_000),
  });
  KindAssertion.assertKind(creation, 'created');
  const { policy }: KindMember<RetryPolicyCreation, 'created'> = creation;
  return policy;
};

class FixedDispatchSettings implements DispatchSettings {
  readonly leaseMs: DurationMs = durationMs(60_000);

  readonly maxRequestMs: DurationMs = durationMs(10_000);

  readonly reconcileDelayMs: DurationMs = durationMs(35_000);

  readonly maxPermitAgeMs: DurationMs = durationMs(40);

  readonly retryPolicy: RetryPolicy = threeAttemptRetryPolicy();
}

class FixedReconcileSettings implements ReconcileSettings {
  readonly retryPolicy: RetryPolicy = threeAttemptRetryPolicy();

  readonly lookupRetryPolicy: RetryPolicy = threeAttemptRetryPolicy();

  readonly unconfirmedAfterMs: DurationMs = durationMs(600_000);

  readonly leaseMs: DurationMs = durationMs(60_000);
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

class PausingMessageSender implements MessageSenderPort {
  readonly sending: Gate = createGate();

  readonly responded: Gate = createGate();

  constructor(private readonly outcome: SendOutcome) {}

  async send(_message: OutgoingMessage): Promise<SendOutcome> {
    this.sending.open();
    await this.responded.opened;
    return this.outcome;
  }
}

class PausingMessageLookup implements MessageLookupPort {
  readonly lookingUp: Gate = createGate();

  readonly answered: Gate = createGate();

  async findByClientRef(_clientRef: DeliveryId): Promise<MessageLookupResult> {
    this.lookingUp.open();
    await this.answered.opened;
    return { kind: 'none' };
  }
}

class CommitHoldingTransaction implements TransactionPort {
  readonly workFinished: Gate = createGate();

  readonly commitAllowed: Gate = createGate();

  constructor(private readonly innerTransaction: TransactionPort) {}

  run<TResult>(work: TransactionWork<TResult>): Promise<TResult> {
    return this.innerTransaction.run(
      async (repositories: TransactionRepositories): Promise<TResult> => {
        const result: TResult = await work(repositories);
        this.workFinished.open();
        await this.commitAllowed.opened;
        return result;
      },
    );
  }

  readSnapshot<TResult>(work: SnapshotWork<TResult>): Promise<TResult> {
    return this.innerTransaction.readSnapshot(work);
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

const claimedRecipientOf = (candidate: Readonly<DeliveryCandidate>): string =>
  candidate.kind === 'found' ? candidate.delivery.snapshot().recipientId : 'none';

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

  const firstOfSavedOrWaitingForLock = <TAttempt>(
    resultSaving: Promise<TAttempt>,
  ): Promise<string> =>
    Promise.race([
      resultSaving.then((): string => SAVED_WITHOUT_WAITING),
      waitUntilAnotherTransactionWaitsForLock().then((): string => WAITED_FOR_CANCEL_COMMIT),
    ]);

  const deliveryStatusesOf = async (id: AlarmId): Promise<ReadonlyArray<string>> =>
    (await deliveriesOf(id)).map((delivery: Delivery): string => delivery.snapshot().state.status);

  const sendWorker = (sender: MessageSenderPort): SendNextDeliveryService =>
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

  const dispatchedBulkAlarm = async (): Promise<AlarmId> => {
    const alarm: Alarm = bulkDraft();
    const dispatchedTransition: AlarmTransition = alarm.startDispatch(new Date(NOW_ISO));
    KindAssertion.assertKind(dispatchedTransition, 'transitioned');
    const { alarm: dispatchedAlarm }: KindMember<AlarmTransition, 'transitioned'> =
      dispatchedTransition;
    await save(dispatchedAlarm);
    const { id: alarmId }: ReturnType<Alarm['snapshot']> = alarm.snapshot();
    return alarmId;
  };

  const insertPendingDeliveries = (
    alarmId: AlarmId,
    priorities: ReadonlyArray<DeliveryPriority>,
  ): Promise<void> =>
    transaction.run(({ deliveryRepository }: TransactionRepositories): Promise<void> =>
      deliveryRepository.insertMissing(
        recipientIds(priorities.length).map((recipientId: RecipientId, index: number): Delivery =>
          Delivery.create(
            {
              id: new RandomDeliveryIdGenerator().deliveryId(),
              alarmId,
              recipientId,
              priority: priorities[index],
            },
            new Date(NOW_ISO),
          ),
        ),
      ),
    );

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
    KindAssertion.assertKind(dispatchedTransition, 'transitioned');
    const { alarm: dispatchedAlarm }: KindMember<AlarmTransition, 'transitioned'> =
      dispatchedTransition;
    const { id: alarmId }: ReturnType<Alarm['snapshot']> = alarm.snapshot();

    await expect(
      transaction.run(
        async ({ alarmRepository, deliveryRepository }: TransactionRepositories): Promise<void> => {
          await alarmRepository.save(dispatchedAlarm);
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
    KindAssertion.assertKind(dispatchedTransition, 'transitioned');
    const { alarm: dispatchedAlarm }: KindMember<AlarmTransition, 'transitioned'> =
      dispatchedTransition;
    const { id: alarmId }: ReturnType<Alarm['snapshot']> = alarm.snapshot();

    await expect(
      transaction.run(
        async ({
          alarmRepository,
          expansionJobRepository,
        }: TransactionRepositories): Promise<void> => {
          await alarmRepository.save(dispatchedAlarm);
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
    const alarmId: AlarmId = await dispatchedBulkAlarm();
    await insertPendingDeliveries(
      alarmId,
      Array.from({ length: 100 }, (): DeliveryPriority => 'BULK'),
    );
    const workerSenders: ReadonlyArray<RecordingMessageSender> = ['first', 'second', 'third'].map(
      (workerName: string): RecordingMessageSender => new RecordingMessageSender(workerName),
    );
    const worker = (sender: RecordingMessageSender): SendNextDeliveryService =>
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
    await Promise.all(
      workerSenders.map((sender: RecordingMessageSender): Promise<void> =>
        drainAll(worker(sender)),
      ),
    );
    const sentClientRefs: ReadonlyArray<string> = workerSenders.flatMap(
      (sender: RecordingMessageSender): ReadonlyArray<string> => sender.clientRefs,
    );

    expect(
      workerSenders.map((sender: RecordingMessageSender): boolean => sender.clientRefs.length > 0),
    ).toEqual([true, true, true]);
    expect(sentClientRefs).toHaveLength(100);
    expect(new Set<string>(sentClientRefs).size).toBe(100);
    expect(
      (await deliveriesOf(alarmId)).every(
        (delivery: Delivery): boolean => delivery.snapshot().state.status === 'SENT',
      ),
    ).toBe(true);
  });

  it('DB-06 한 트랜잭션이 가장 앞선 대기 Delivery를 claim해 잠근 채 열려 있다 / 다른 트랜잭션이 claim한다 (FOR UPDATE SKIP LOCKED) → 잠금이 풀리기를 기다리지 않고 잠기지 않은 다음 Delivery를 받는다', async (): Promise<void> => {
    const alarmId: AlarmId = await dispatchedBulkAlarm();
    await insertPendingDeliveries(alarmId, ['URGENT', 'BULK']);
    const locked: Gate = createGate();
    const release: Gate = createGate();
    const holder: Promise<DeliveryCandidate> = transaction.run(
      async ({ deliveryRepository }: TransactionRepositories): Promise<DeliveryCandidate> => {
        const heldCandidate: DeliveryCandidate = await deliveryRepository.findNextClaimable(
          new Date(NOW_ISO),
        );
        locked.open();
        await release.opened;
        return heldCandidate;
      },
    );
    await locked.opened;

    const contender: Promise<DeliveryCandidate> = transaction.run(
      ({ deliveryRepository }: TransactionRepositories): Promise<DeliveryCandidate> =>
        deliveryRepository.findNextClaimable(new Date(NOW_ISO)),
    );
    try {
      await vi.waitFor((): Promise<DeliveryCandidate> => contender, {
        timeout: 2_000,
        interval: 10,
      });
    } finally {
      release.open();
      await Promise.allSettled([holder, contender]);
    }

    expect(claimedRecipientOf(await holder)).toBe('u_000001');
    expect(claimedRecipientOf(await contender)).toBe('u_000002');
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
        KindAssertion.assertKind(cancelled, 'transitioned');
        const { alarm: cancelledAlarm }: KindMember<AlarmTransition, 'transitioned'> = cancelled;
        await alarmRepository.save(cancelledAlarm);
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
        await expansionJobRepository.save(
          ExpansionJob.reconstitute({
            alarmId,
            enqueuedAt: new Date(NOW_ISO),
            progress: { kind: 'completed', completedAt: new Date(NOW_ISO) },
          }),
        );
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

    const waitedLookup: ExpansionJobLookup = await waiter;
    KindAssertion.assertKind(waitedLookup, 'found');
    const { job: waitedJob }: KindMember<ExpansionJobLookup, 'found'> = waitedLookup;
    expect(waitedJob.isCompleted()).toBe(true);
  });
  it('DB-20 응답을 기다리는 Delivery가 있는 알림을 취소 트랜잭션이 잠그고 대기 Delivery를 취소한 채 아직 커밋하지 않았다 / 워커가 재시도할 결과를 저장한다 → 결과 저장이 취소 커밋을 기다렸다가 취소된 알림을 보고 RETRY_WAIT 대신 CANCELLED로 저장한다', async (): Promise<void> => {
    const alarmId: AlarmId = await dispatchedBulkAlarm();
    await insertPendingDeliveries(alarmId, ['BULK']);
    const sender: PausingMessageSender = new PausingMessageSender({ kind: 'transient-failure' });
    const sendAttempt: Promise<SendAttempt> = sendWorker(sender).execute();
    await sender.sending.opened;
    const cancelTransaction: CommitHoldingTransaction = new CommitHoldingTransaction(transaction);
    const cancelling: Promise<CancelAlarmResult> = new CancelAlarmService(
      cancelTransaction,
      new FixedClock(),
    ).execute({ alarmId });

    let resultSavingOrder: string = '';
    try {
      await cancelTransaction.workFinished.opened;
      sender.responded.open();
      resultSavingOrder = await firstOfSavedOrWaitingForLock(sendAttempt);
    } finally {
      cancelTransaction.commitAllowed.open();
      await Promise.allSettled([sendAttempt, cancelling]);
    }

    expect(await deliveryStatusesOf(alarmId)).toEqual(['CANCELLED']);
    expect(resultSavingOrder).toBe(WAITED_FOR_CANCEL_COMMIT);
    expect(await cancelling).toMatchObject({ kind: 'cancelled' });
  });

  it('DB-20 reconcile 조회 중 취소 트랜잭션이 커밋 전이면 발송 내역이 없다는 결과도 취소 커밋을 기다렸다가 RETRY_WAIT 대신 CANCELLED로 저장한다', async (): Promise<void> => {
    const alarmId: AlarmId = await dispatchedBulkAlarm();
    await insertPendingDeliveries(alarmId, ['BULK']);
    const timedOutSender: PausingMessageSender = new PausingMessageSender({
      kind: 'indeterminate',
    });
    timedOutSender.responded.open();
    await sendWorker(timedOutSender).execute();
    expect(await deliveryStatusesOf(alarmId)).toEqual(['UNKNOWN']);
    const lookup: PausingMessageLookup = new PausingMessageLookup();
    const reconcileAttempt: Promise<ReconcileAttempt> = new ReconcileNextDeliveryService(
      transaction,
      lookup,
      new FixedClock(RECONCILE_DUE_ISO),
      new FixedReconcileSettings(),
      new ZeroJitter(),
    ).execute();
    await lookup.lookingUp.opened;
    const cancelTransaction: CommitHoldingTransaction = new CommitHoldingTransaction(transaction);
    const cancelling: Promise<CancelAlarmResult> = new CancelAlarmService(
      cancelTransaction,
      new FixedClock(),
    ).execute({ alarmId });

    let resultSavingOrder: string = '';
    try {
      await cancelTransaction.workFinished.opened;
      lookup.answered.open();
      resultSavingOrder = await firstOfSavedOrWaitingForLock(reconcileAttempt);
    } finally {
      cancelTransaction.commitAllowed.open();
      await Promise.allSettled([reconcileAttempt, cancelling]);
    }

    expect(await deliveryStatusesOf(alarmId)).toEqual(['CANCELLED']);
    expect(resultSavingOrder).toBe(WAITED_FOR_CANCEL_COMMIT);
    expect(await cancelling).toMatchObject({ kind: 'cancelled' });
  });
});
