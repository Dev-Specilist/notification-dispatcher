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
import { DeliveryId, DeliverySnapshot } from '@/modules/notification/domain/delivery/delivery.type';
import { ClockPort } from '@/modules/notification/application/port/driven/for-telling-time/clock.port';
import { DeliveryIdGeneratorPort } from '@/modules/notification/application/port/driven/for-generating-ids/delivery-id-generator.port';
import { ExpansionProgress } from '@/modules/notification/application/port/driven/for-storing-expansion-jobs/expansion-job-repository.type';
import { ExpansionSettings } from '@/modules/notification/application/service/expansion/expansion-settings.type';
import { RecipientDirectoryPort } from '@/modules/notification/application/port/driven/for-fetching-recipients/recipient-directory.port';
import {
  PageCursor,
  RecipientPage,
} from '@/modules/notification/application/port/driven/for-fetching-recipients/recipient-directory.type';
import { ExpansionPageAttempt } from '@/modules/notification/application/port/driving/for-dispatching-alarms/expand-next-page.type';
import { CancelAlarmService } from '@/modules/notification/application/service/alarm/cancel-alarm.service';
import { ExpandNextPageService } from '@/modules/notification/application/service/expansion/expand-next-page.service';
import { InMemoryAlarmRepositoryAdapter } from '@/modules/notification/testing/in-memory/in-memory-alarm-repository.adapter';
import { InMemoryDeliveryRepositoryAdapter } from '@/modules/notification/testing/in-memory/in-memory-delivery-repository.adapter';
import { InMemoryExpansionJobRepositoryAdapter } from '@/modules/notification/testing/in-memory/in-memory-expansion-job-repository.adapter';
import { InMemoryTransactionAdapter } from '@/modules/notification/testing/in-memory/in-memory-transaction.adapter';
import { DurationPredicates } from '@/shared/domain/duration.predicate';
import { DurationMs } from '@/shared/domain/duration.type';
import { KindAssertion, KindMember } from '@/shared/testing/kind.assertion';
import { createGate, Gate } from '@/shared/testing/gate.factory';

type PageEntry = Readonly<[cursorKey: string, page: RecipientPage]>;

type RecipientStatus = Readonly<[recipientId: string, status: string]>;

type DeliverySummary = Pick<DeliverySnapshot, 'recipientId' | 'priority' | 'state' | 'createdAt'>;

interface Repositories {
  readonly alarmRepository: InMemoryAlarmRepositoryAdapter;
  readonly expansionJobRepository: InMemoryExpansionJobRepositoryAdapter;
}

interface Fixture extends Repositories {
  readonly deliveryRepository: InMemoryDeliveryRepositoryAdapter;
  readonly transaction: InMemoryTransactionAdapter;
  readonly clock: MovableClock;
  readonly service: ExpandNextPageService;
  readonly newWorker: () => ExpandNextPageService;
}

const OLDER_ALARM_ID: string = '0b6c1b4e-9a37-4c2a-8d6a-2f6b2d7f1a10';
const NEWER_ALARM_ID: string = '7d3f1e2a-4b5c-4d6e-8f70-1a2b3c4d5e6f';
const OLDER_ENQUEUED_ISO: string = '2026-10-07T09:05:00.000Z';
const NEWER_ENQUEUED_ISO: string = '2026-10-07T09:05:10.000Z';
const CANCELLED_ISO: string = '2026-10-07T09:05:30.000Z';
const EXPANDED_ISO: string = '2026-10-07T09:06:00.000Z';
const BEFORE_LEASE_EXPIRY_ISO: string = '2026-10-07T09:06:29.000Z';
const AFTER_LEASE_EXPIRY_ISO: string = '2026-10-07T09:06:31.000Z';
const LEASE_MS: number = 30_000;

const alarmId = (rawAlarmId: string): AlarmId => {
  if (!AlarmPredicates.isAlarmId(rawAlarmId)) {
    throw new Error(`test fixture ${rawAlarmId} is not a valid AlarmId`);
  }
  return rawAlarmId;
};

const recipientIds = (...rawRecipientIds: ReadonlyArray<string>): ReadonlyArray<RecipientId> =>
  rawRecipientIds.map((rawRecipientId: string): RecipientId => {
    if (!AlarmPredicates.isRecipientId(rawRecipientId)) {
      throw new Error(`test fixture ${rawRecipientId} is not a valid RecipientId`);
    }
    return rawRecipientId;
  });

const cursorKey = (cursor: PageCursor): string =>
  cursor.kind === 'first' ? 'first' : `next:${cursor.token}`;

const TWO_PAGES: ReadonlyArray<PageEntry> = [
  [
    'first',
    { recipientIds: recipientIds('u_000001', 'u_000002'), next: { kind: 'next', token: 'Mw' } },
  ],
  ['next:Mw', { recipientIds: recipientIds('u_000003'), next: { kind: 'end' } }],
];

const transitionedAlarm = (transition: AlarmTransition): Alarm => {
  KindAssertion.assertKind(transition, 'transitioned');
  const { alarm }: KindMember<AlarmTransition, 'transitioned'> = transition;
  return alarm;
};

const dispatchedBulkAlarm = (rawAlarmId: string): Alarm => {
  const creation: AlarmCreation = Alarm.create(
    alarmId(rawAlarmId),
    { title: '추석 이벤트', body: '쿠폰 도착', kind: 'BULK', recipientIds: [] },
    new Date('2026-10-07T09:00:00.000Z'),
  );
  KindAssertion.assertKind(creation, 'created');
  const { alarm }: KindMember<AlarmCreation, 'created'> = creation;
  return transitionedAlarm(alarm.startDispatch(new Date(OLDER_ENQUEUED_ISO)));
};

const cancelStoredAlarm = async (alarmRepository: InMemoryAlarmRepositoryAdapter): Promise<void> =>
  alarmRepository.save(
    transitionedAlarm(dispatchedBulkAlarm(OLDER_ALARM_ID).cancel(new Date(CANCELLED_ISO))),
  );

class MovableClock implements ClockPort {
  private current: Date = new Date(EXPANDED_ISO);

  now(): Date {
    return new Date(this.current.getTime());
  }

  moveTo(iso: string): void {
    this.current = new Date(iso);
  }
}

class PagedRecipientDirectory implements RecipientDirectoryPort {
  readonly requested: Array<string> = [];

  private readonly pagesByCursorKey: ReadonlyMap<string, RecipientPage>;

  constructor(pages: ReadonlyArray<PageEntry>) {
    this.pagesByCursorKey = new Map<string, RecipientPage>(pages);
  }

  fetchPage(cursor: PageCursor): Promise<RecipientPage> {
    const requestedKey: string = cursorKey(cursor);
    this.requested.push(requestedKey);
    for (const [pageKey, page] of this.pagesByCursorKey) {
      if (pageKey === requestedKey) {
        return Promise.resolve(page);
      }
    }
    return Promise.reject(new Error(`no page for ${requestedKey}`));
  }
}

class FailingOnceDirectory extends PagedRecipientDirectory {
  private failed: boolean = false;

  constructor(
    pages: ReadonlyArray<PageEntry>,
    private readonly failingKey: string,
  ) {
    super(pages);
  }

  override fetchPage(cursor: PageCursor): Promise<RecipientPage> {
    if (!this.failed && cursorKey(cursor) === this.failingKey) {
      this.failed = true;
      this.requested.push(cursorKey(cursor));
      return Promise.reject(new Error('user API is unavailable'));
    }
    return super.fetchPage(cursor);
  }
}

class CancellingDirectory extends PagedRecipientDirectory {
  constructor(
    pages: ReadonlyArray<PageEntry>,
    private readonly cancellingKey: string,
    private readonly alarmRepository: InMemoryAlarmRepositoryAdapter,
  ) {
    super(pages);
  }

  override async fetchPage(cursor: PageCursor): Promise<RecipientPage> {
    if (cursorKey(cursor) === this.cancellingKey) {
      await cancelStoredAlarm(this.alarmRepository);
    }
    return super.fetchPage(cursor);
  }
}

class PausingOnceDirectory extends PagedRecipientDirectory {
  readonly paused: Gate = createGate();

  readonly resumed: Gate = createGate();

  private pausedOnce: boolean = false;

  constructor(
    pages: ReadonlyArray<PageEntry>,
    private readonly pausingKey: string,
  ) {
    super(pages);
  }

  override async fetchPage(cursor: PageCursor): Promise<RecipientPage> {
    if (!this.pausedOnce && cursorKey(cursor) === this.pausingKey) {
      this.pausedOnce = true;
      this.paused.open();
      await this.resumed.opened;
    }
    return super.fetchPage(cursor);
  }
}

class FailingOnSecondProgressRepository extends InMemoryExpansionJobRepositoryAdapter {
  private recorded: number = 0;

  override recordProgress(owner: AlarmId, progress: ExpansionProgress): Promise<void> {
    this.recorded += 1;
    if (this.recorded === 2) {
      return Promise.reject(new Error('expansion progress storage is unavailable'));
    }
    return super.recordProgress(owner, progress);
  }
}

class SequentialDeliveryIdGenerator implements DeliveryIdGeneratorPort {
  private issued: number = 0;

  deliveryId(): DeliveryId {
    this.issued += 1;
    const rawDeliveryId: string = `00000000-0000-4000-8000-${String(this.issued).padStart(12, '0')}`;
    if (!DeliveryPredicates.isDeliveryId(rawDeliveryId)) {
      throw new Error(`generated ${rawDeliveryId} is not a valid DeliveryId`);
    }
    return rawDeliveryId;
  }
}

class FixedExpansionSettings implements ExpansionSettings {
  readonly leaseMs: DurationMs = FixedExpansionSettings.durationMs(LEASE_MS);

  private static durationMs(rawDurationMs: number): DurationMs {
    if (!DurationPredicates.isDurationMs(rawDurationMs)) {
      throw new Error(`test fixture ${rawDurationMs} is not a valid DurationMs`);
    }
    return rawDurationMs;
  }
}

const freshRepositories = (): Repositories => ({
  alarmRepository: new InMemoryAlarmRepositoryAdapter(),
  expansionJobRepository: new InMemoryExpansionJobRepositoryAdapter(),
});

const fixture = async (
  directory: RecipientDirectoryPort,
  enqueuedAlarmIds: ReadonlyArray<string>,
  { alarmRepository, expansionJobRepository }: Repositories = freshRepositories(),
): Promise<Fixture> => {
  const deliveryRepository: InMemoryDeliveryRepositoryAdapter =
    new InMemoryDeliveryRepositoryAdapter();
  const enqueuedIsos: ReadonlyArray<string> = [OLDER_ENQUEUED_ISO, NEWER_ENQUEUED_ISO];
  for (const [enqueueIndex, rawAlarmId] of enqueuedAlarmIds.entries()) {
    await alarmRepository.save(dispatchedBulkAlarm(rawAlarmId));
    await expansionJobRepository.enqueue(alarmId(rawAlarmId), new Date(enqueuedIsos[enqueueIndex]));
  }
  const clock: MovableClock = new MovableClock();
  const transaction: InMemoryTransactionAdapter = new InMemoryTransactionAdapter({
    alarmRepository,
    deliveryRepository,
    expansionJobRepository,
  });
  const deliveryIdGenerator: SequentialDeliveryIdGenerator = new SequentialDeliveryIdGenerator();
  const newWorker = (): ExpandNextPageService =>
    new ExpandNextPageService(
      transaction,
      directory,
      deliveryIdGenerator,
      new FixedExpansionSettings(),
      clock,
    );
  return {
    alarmRepository,
    expansionJobRepository,
    deliveryRepository,
    transaction,
    clock,
    service: newWorker(),
    newWorker,
  };
};

const expandedStep = (step: string): ExpansionPageAttempt => {
  if (
    step !== 'continued' &&
    step !== 'completed' &&
    step !== 'cancelled' &&
    step !== 'superseded' &&
    step !== 'not-found'
  ) {
    throw new Error(`test fixture ${step} is not an expansion step`);
  }
  return { kind: 'expanded', alarmId: OLDER_ALARM_ID, step };
};

const summaries = async (
  deliveryRepository: InMemoryDeliveryRepositoryAdapter,
): Promise<ReadonlyArray<DeliverySummary>> =>
  (await deliveryRepository.findByAlarmId(alarmId(OLDER_ALARM_ID))).map(
    (delivery: Delivery): DeliverySummary => {
      const { recipientId, priority, state, createdAt }: DeliverySnapshot = delivery.snapshot();
      return { recipientId, priority, state, createdAt };
    },
  );

const pendingBulk = (rawRecipientId: string): DeliverySummary => {
  const [recipientId]: ReadonlyArray<RecipientId> = recipientIds(rawRecipientId);
  return {
    recipientId,
    priority: 'BULK',
    state: { status: 'PENDING' },
    createdAt: new Date(EXPANDED_ISO),
  };
};

describe('ExpandNextPageService', () => {
  it('UC-18 진행 중인 확장 작업이 없으면 아무것도 하지 않는다', async (): Promise<void> => {
    const { service }: Fixture = await fixture(new PagedRecipientDirectory(TWO_PAGES), []);

    expect(await service.execute()).toEqual({ kind: 'idle' });
  });

  it('UC-18 진행 중인 확장 작업 여러 개 / 다음 확장 페이지 유스케이스 → 잡을 수 있는 작업 하나의 한 페이지만 처리하고 진행을 기록해, 다음 페이지는 다른 워커도 이어받을 수 있다', async (): Promise<void> => {
    const directory: PagedRecipientDirectory = new PagedRecipientDirectory(TWO_PAGES);
    const { deliveryRepository, newWorker }: Fixture = await fixture(directory, [OLDER_ALARM_ID]);

    const firstPageAttempt: ExpansionPageAttempt = await newWorker().execute();
    const deliveriesAfterFirstPage: number = (
      await deliveryRepository.findByAlarmId(alarmId(OLDER_ALARM_ID))
    ).length;
    const secondPageAttempt: ExpansionPageAttempt = await newWorker().execute();

    expect(firstPageAttempt).toEqual(expandedStep('continued'));
    expect(deliveriesAfterFirstPage).toBe(2);
    expect(secondPageAttempt).toEqual(expandedStep('completed'));
    expect(directory.requested).toEqual(['first', 'next:Mw']);
    expect(await deliveryRepository.findByAlarmId(alarmId(OLDER_ALARM_ID))).toHaveLength(3);
  });

  it('UC-18 다른 워커가 lease로 잡고 있는 확장 작업은 건너뛰고 다음 작업을 처리한다', async (): Promise<void> => {
    const { expansionJobRepository, service }: Fixture = await fixture(
      new PagedRecipientDirectory(TWO_PAGES),
      [OLDER_ALARM_ID, NEWER_ALARM_ID],
    );
    await expansionJobRepository.claimNext(
      new Date(EXPANDED_ISO),
      new Date(new Date(EXPANDED_ISO).getTime() + LEASE_MS),
    );

    expect(await service.execute()).toEqual({
      kind: 'expanded',
      alarmId: NEWER_ALARM_ID,
      step: 'continued',
    });
  });

  it('UC-18 페이지 처리 중 실패하면 lease가 남아 만료 전에는 다시 잡지 않고, 만료 후 다른 시도가 저장된 cursor부터 이어간다', async (): Promise<void> => {
    const { clock, service }: Fixture = await fixture(
      new FailingOnceDirectory(TWO_PAGES, 'first'),
      [OLDER_ALARM_ID],
    );

    await expect(service.execute()).rejects.toThrow('user API is unavailable');
    clock.moveTo(BEFORE_LEASE_EXPIRY_ISO);
    const attemptBeforeExpiry: ExpansionPageAttempt = await service.execute();
    clock.moveTo(AFTER_LEASE_EXPIRY_ISO);
    const attemptAfterExpiry: ExpansionPageAttempt = await service.execute();

    expect(attemptBeforeExpiry).toEqual({ kind: 'idle' });
    expect(attemptAfterExpiry).toEqual(expandedStep('continued'));
  });

  it('UC-06 확장 대기 중인 대량 알림 / 확장 유스케이스가 사용자 API를 cursor 끝까지 읽는다 → 페이지마다 Delivery 생성과 cursor 저장이 한 트랜잭션으로 커밋된다', async (): Promise<void> => {
    const directory: PagedRecipientDirectory = new PagedRecipientDirectory(TWO_PAGES);
    const { deliveryRepository, expansionJobRepository, service }: Fixture = await fixture(
      directory,
      [OLDER_ALARM_ID],
    );

    expect(await service.execute()).toEqual(expandedStep('continued'));
    expect(await service.execute()).toEqual(expandedStep('completed'));
    expect(directory.requested).toEqual(['first', 'next:Mw']);
    expect(await summaries(deliveryRepository)).toEqual([
      pendingBulk('u_000001'),
      pendingBulk('u_000002'),
      pendingBulk('u_000003'),
    ]);
    expect(await expansionJobRepository.findByAlarmId(alarmId(OLDER_ALARM_ID))).toMatchObject({
      kind: 'found',
      job: { progress: { kind: 'completed', completedAt: new Date(EXPANDED_ISO) } },
    });
  });

  it('UC-06 한 페이지의 cursor 저장이 실패하면 그 페이지의 Delivery도 롤백되고 앞 페이지는 커밋된 채 남는다', async (): Promise<void> => {
    const { deliveryRepository, expansionJobRepository, service }: Fixture = await fixture(
      new PagedRecipientDirectory(TWO_PAGES),
      [OLDER_ALARM_ID],
      {
        alarmRepository: new InMemoryAlarmRepositoryAdapter(),
        expansionJobRepository: new FailingOnSecondProgressRepository(),
      },
    );

    await service.execute();
    await expect(service.execute()).rejects.toThrow('expansion progress storage is unavailable');

    expect(await summaries(deliveryRepository)).toEqual([
      pendingBulk('u_000001'),
      pendingBulk('u_000002'),
    ]);
    expect(await expansionJobRepository.findByAlarmId(alarmId(OLDER_ALARM_ID))).toMatchObject({
      job: { progress: { kind: 'in-progress', cursor: { kind: 'next', token: 'Mw' } } },
    });
  });

  it('UC-06 수신자가 0명이면 Delivery 없이 확장을 완료한다', async (): Promise<void> => {
    const { deliveryRepository, expansionJobRepository, service }: Fixture = await fixture(
      new PagedRecipientDirectory([['first', { recipientIds: [], next: { kind: 'end' } }]]),
      [OLDER_ALARM_ID],
    );

    expect(await service.execute()).toEqual(expandedStep('completed'));
    expect(await summaries(deliveryRepository)).toEqual([]);
    expect(await expansionJobRepository.findByAlarmId(alarmId(OLDER_ALARM_ID))).toMatchObject({
      job: { progress: { kind: 'completed' } },
    });
  });

  it('UC-06 완료된 확장은 다시 잡지 않아 사용자 API를 다시 읽지 않는다', async (): Promise<void> => {
    const directory: PagedRecipientDirectory = new PagedRecipientDirectory(TWO_PAGES);
    const { service }: Fixture = await fixture(directory, [OLDER_ALARM_ID]);
    await service.execute();
    await service.execute();

    expect(await service.execute()).toEqual({ kind: 'idle' });
    expect(directory.requested).toEqual(['first', 'next:Mw']);
  });

  it('UC-07 확장 도중 워커가 멈췄다 / 다른 워커가 확장을 이어받는다 → 저장된 cursor부터 이어서 읽고 같은 수신자의 Delivery는 중복 생성되지 않는다', async (): Promise<void> => {
    const directory: FailingOnceDirectory = new FailingOnceDirectory(TWO_PAGES, 'next:Mw');
    const { deliveryRepository, clock, service, newWorker }: Fixture = await fixture(directory, [
      OLDER_ALARM_ID,
    ]);
    await service.execute();
    await expect(service.execute()).rejects.toThrow('user API is unavailable');
    clock.moveTo(AFTER_LEASE_EXPIRY_ISO);

    expect(await newWorker().execute()).toEqual(expandedStep('completed'));
    expect(directory.requested).toEqual(['first', 'next:Mw', 'next:Mw']);
    expect(
      (await summaries(deliveryRepository)).map(
        ({ recipientId }: DeliverySummary): string => recipientId,
      ),
    ).toEqual(['u_000001', 'u_000002', 'u_000003']);
  });

  it('UC-07 cursor 저장에 실패한 뒤 다른 워커가 이어받아도 Delivery는 중복 생성되지 않는다', async (): Promise<void> => {
    const { deliveryRepository, clock, service, newWorker }: Fixture = await fixture(
      new PagedRecipientDirectory(TWO_PAGES),
      [OLDER_ALARM_ID],
      {
        alarmRepository: new InMemoryAlarmRepositoryAdapter(),
        expansionJobRepository: new FailingOnSecondProgressRepository(),
      },
    );
    await service.execute();
    await expect(service.execute()).rejects.toThrow('expansion progress storage is unavailable');
    clock.moveTo(AFTER_LEASE_EXPIRY_ISO);

    expect(await newWorker().execute()).toEqual(expandedStep('completed'));
    expect(
      (await summaries(deliveryRepository)).map(
        ({ recipientId }: DeliverySummary): string => recipientId,
      ),
    ).toEqual(['u_000001', 'u_000002', 'u_000003']);
  });

  it('UC-07 lease가 만료된 뒤 다른 워커가 같은 페이지를 먼저 저장하면 늦게 끝난 워커의 페이지는 저장하지 않는다', async (): Promise<void> => {
    const directory: PausingOnceDirectory = new PausingOnceDirectory(TWO_PAGES, 'first');
    const { deliveryRepository, clock, service, newWorker }: Fixture = await fixture(directory, [
      OLDER_ALARM_ID,
    ]);
    const lateWorkerAttempt: Promise<ExpansionPageAttempt> = service.execute();
    await directory.paused.opened;
    clock.moveTo(AFTER_LEASE_EXPIRY_ISO);

    expect(await newWorker().execute()).toEqual(expandedStep('continued'));
    directory.resumed.open();

    expect(await lateWorkerAttempt).toEqual(expandedStep('superseded'));
    expect(await summaries(deliveryRepository)).toHaveLength(2);
  });

  it('UC-08 확장 중 알림이 취소됐다 / 다음 페이지를 처리한다 → 확장을 멈추고 더 이상 Delivery를 만들지 않는다', async (): Promise<void> => {
    const repositories: Repositories = freshRepositories();
    const directory: CancellingDirectory = new CancellingDirectory(
      TWO_PAGES,
      'next:Mw',
      repositories.alarmRepository,
    );
    const { deliveryRepository, expansionJobRepository, service }: Fixture = await fixture(
      directory,
      [OLDER_ALARM_ID],
      repositories,
    );
    await service.execute();

    expect(await service.execute()).toEqual(expandedStep('cancelled'));
    expect(directory.requested).toEqual(['first', 'next:Mw']);
    expect(await summaries(deliveryRepository)).toEqual([
      pendingBulk('u_000001'),
      pendingBulk('u_000002'),
    ]);
    expect(await expansionJobRepository.findByAlarmId(alarmId(OLDER_ALARM_ID))).toMatchObject({
      job: { progress: { kind: 'stopped', stoppedAt: new Date(EXPANDED_ISO) } },
    });
  });

  it('UC-08 페이지 조회 중 취소 유스케이스가 실행되면 이미 만든 Delivery는 취소되고 새 Delivery는 만들어지지 않는다', async (): Promise<void> => {
    const directory: PausingOnceDirectory = new PausingOnceDirectory(TWO_PAGES, 'next:Mw');
    const { deliveryRepository, transaction, clock, service }: Fixture = await fixture(directory, [
      OLDER_ALARM_ID,
    ]);
    await service.execute();
    const expansion: Promise<ExpansionPageAttempt> = service.execute();
    await directory.paused.opened;

    await new CancelAlarmService(transaction, clock).execute({ alarmId: OLDER_ALARM_ID });
    directory.resumed.open();

    expect(await expansion).toEqual(expandedStep('cancelled'));
    expect(
      (await summaries(deliveryRepository)).map(
        ({ recipientId, state }: DeliverySummary): RecipientStatus => [recipientId, state.status],
      ),
    ).toEqual([
      ['u_000001', 'CANCELLED'],
      ['u_000002', 'CANCELLED'],
    ]);
  });

  it('UC-08 이미 취소된 알림은 사용자 API를 호출하지 않고 확장을 멈춘다', async (): Promise<void> => {
    const directory: PagedRecipientDirectory = new PagedRecipientDirectory(TWO_PAGES);
    const { alarmRepository, deliveryRepository, service }: Fixture = await fixture(directory, [
      OLDER_ALARM_ID,
    ]);
    await cancelStoredAlarm(alarmRepository);

    expect(await service.execute()).toEqual(expandedStep('cancelled'));
    expect(directory.requested).toEqual([]);
    expect(await summaries(deliveryRepository)).toEqual([]);
  });

  it('UC-08 멈춘 확장은 다시 잡지 않아 사용자 API를 호출하지 않는다', async (): Promise<void> => {
    const directory: PagedRecipientDirectory = new PagedRecipientDirectory(TWO_PAGES);
    const { alarmRepository, service, newWorker }: Fixture = await fixture(directory, [
      OLDER_ALARM_ID,
    ]);
    await cancelStoredAlarm(alarmRepository);
    await service.execute();

    expect(await newWorker().execute()).toEqual({ kind: 'idle' });
    expect(directory.requested).toEqual([]);
  });
});
