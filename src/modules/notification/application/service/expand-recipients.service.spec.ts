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
import { ClockPort } from '@/modules/notification/application/port/out/clock.port';
import { CancelAlarmService } from '@/modules/notification/application/service/cancel-alarm.service';
import { ExpansionProgress } from '@/modules/notification/application/port/out/expansion-job-repository.type';
import { IdGeneratorPort } from '@/modules/notification/application/port/out/id-generator.port';
import { RecipientDirectoryPort } from '@/modules/notification/application/port/out/recipient-directory.port';
import {
  PageCursor,
  RecipientPage,
} from '@/modules/notification/application/port/out/recipient-directory.type';
import { ExpansionResult } from '@/modules/notification/application/port/in/expand-recipients.type';
import { ExpandRecipientsService } from '@/modules/notification/application/service/expand-recipients.service';
import { InMemoryAlarmRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-alarm-repository.adapter';
import { InMemoryDeliveryRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-delivery-repository.adapter';
import { InMemoryExpansionJobRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-expansion-job-repository.adapter';
import { InMemoryUnitOfWorkAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-unit-of-work.adapter';

type PageEntry = Readonly<[string, RecipientPage]>;

type RecipientStatus = Readonly<[string, string]>;

interface PageFound {
  readonly kind: 'found';
  readonly page: RecipientPage;
}

interface PageMissing {
  readonly kind: 'missing';
}

type PageLookup = PageFound | PageMissing;

type PageIndexEntry = Readonly<[string, PageFound]>;

type DeliverySummary = Pick<DeliverySnapshot, 'recipientId' | 'priority' | 'state' | 'createdAt'>;

interface Fixture {
  readonly alarmRepository: InMemoryAlarmRepositoryAdapter;
  readonly unitOfWork: InMemoryUnitOfWorkAdapter;
  readonly deliveryRepository: InMemoryDeliveryRepositoryAdapter;
  readonly expansionJobRepository: InMemoryExpansionJobRepositoryAdapter;
  readonly directory: PagedRecipientDirectory;
  readonly useCase: ExpandRecipientsService;
  readonly newWorker: () => ExpandRecipientsService;
}

const ENQUEUED_ISO: string = '2026-10-07T09:05:00.000Z';
const EXPANDED_ISO: string = '2026-10-07T09:06:00.000Z';
const ALARM_ID: string = '0b6c1b4e-9a37-4c2a-8d6a-2f6b2d7f1a10';
const MISSING_ALARM_ID: string = '7d3f1e2a-4b5c-4d6e-8f70-1a2b3c4d5e6f';

const alarmId = (value: string): AlarmId => {
  if (!AlarmPredicates.isAlarmId(value)) {
    throw new Error(`test fixture ${value} is not a valid AlarmId`);
  }
  return value;
};

const recipientIds = (...values: ReadonlyArray<string>): ReadonlyArray<RecipientId> =>
  values.map((value: string): RecipientId => {
    if (!AlarmPredicates.isRecipientId(value)) {
      throw new Error(`test fixture ${value} is not a valid RecipientId`);
    }
    return value;
  });

const cursorKey = (cursor: PageCursor): string =>
  cursor.kind === 'first' ? 'first' : `next:${cursor.token}`;

class PagedRecipientDirectory implements RecipientDirectoryPort {
  readonly requested: Array<string> = [];

  private readonly pagesByKey: ReadonlyMap<string, PageFound>;

  constructor(pages: ReadonlyArray<PageEntry>) {
    this.pagesByKey = new Map<string, PageFound>(
      pages.map(([key, page]: PageEntry): PageIndexEntry => [key, { kind: 'found', page }]),
    );
  }

  fetchPage(cursor: PageCursor): Promise<RecipientPage> {
    const key: string = cursorKey(cursor);
    this.requested.push(key);
    const lookup: PageLookup = this.pagesByKey.get(key) ?? { kind: 'missing' };
    if (lookup.kind === 'missing') {
      return Promise.reject(new Error(`no page for ${key}`));
    }
    return Promise.resolve(lookup.page);
  }
}

class FixedClock implements ClockPort {
  now(): Date {
    return new Date(EXPANDED_ISO);
  }
}

class SequentialIdGenerator implements IdGeneratorPort {
  private issued: number = 0;

  alarmId(): AlarmId {
    return alarmId(ALARM_ID);
  }

  deliveryId(): DeliveryId {
    this.issued += 1;
    const value: string = `00000000-0000-4000-8000-${String(this.issued).padStart(12, '0')}`;
    if (!DeliveryPredicates.isDeliveryId(value)) {
      throw new Error(`generated ${value} is not a valid DeliveryId`);
    }
    return value;
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

const CANCELLED_ISO: string = '2026-10-07T09:05:30.000Z';

const transitionedAlarm = (transition: AlarmTransition): Alarm => {
  if (transition.kind !== 'transitioned') {
    throw new Error(`test fixture alarm transition failed: ${transition.error.code}`);
  }
  return transition.alarm;
};

const dispatchedBulkAlarm = (): Alarm => {
  const creation: AlarmCreation = Alarm.create(
    alarmId(ALARM_ID),
    { title: '추석 이벤트', body: '쿠폰 도착', kind: 'BULK', recipientIds: [] },
    new Date('2026-10-07T09:00:00.000Z'),
  );
  if (creation.kind !== 'created') {
    throw new Error(`test fixture alarm is invalid: ${creation.error.code}`);
  }
  return transitionedAlarm(creation.alarm.startDispatch(new Date(ENQUEUED_ISO)));
};

const cancelStoredAlarm = async (alarmRepository: InMemoryAlarmRepositoryAdapter): Promise<void> =>
  alarmRepository.save(transitionedAlarm(dispatchedBulkAlarm().cancel(new Date(CANCELLED_ISO))));

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

interface Gate {
  readonly opened: Promise<void>;
  readonly open: () => void;
}

const NOT_YET_OPENED: () => void = (): void => {};

const createGate = (): Gate => {
  let release: () => void = NOT_YET_OPENED;
  const opened: Promise<void> = new Promise<void>((resolve: () => void): void => {
    release = resolve;
  });
  return { opened, open: (): void => release() };
};

class PausingDirectory extends PagedRecipientDirectory {
  readonly paused: Gate = createGate();

  readonly resumed: Gate = createGate();

  constructor(
    pages: ReadonlyArray<PageEntry>,
    private readonly pausingKey: string,
  ) {
    super(pages);
  }

  override async fetchPage(cursor: PageCursor): Promise<RecipientPage> {
    if (cursorKey(cursor) === this.pausingKey) {
      this.paused.open();
      await this.resumed.opened;
    }
    return super.fetchPage(cursor);
  }
}

const TWO_PAGES: ReadonlyArray<PageEntry> = [
  [
    'first',
    { recipientIds: recipientIds('u_000001', 'u_000002'), next: { kind: 'next', token: 'Mw' } },
  ],
  ['next:Mw', { recipientIds: recipientIds('u_000003'), next: { kind: 'end' } }],
];

const fixture = async (
  pages: ReadonlyArray<PageEntry>,
  expansionJobRepository: InMemoryExpansionJobRepositoryAdapter = new InMemoryExpansionJobRepositoryAdapter(),
  alarmRepository: InMemoryAlarmRepositoryAdapter = new InMemoryAlarmRepositoryAdapter(),
  directory: PagedRecipientDirectory = new PagedRecipientDirectory(pages),
): Promise<Fixture> => {
  const deliveryRepository: InMemoryDeliveryRepositoryAdapter =
    new InMemoryDeliveryRepositoryAdapter();
  await alarmRepository.save(dispatchedBulkAlarm());
  await expansionJobRepository.enqueue(alarmId(ALARM_ID), new Date(ENQUEUED_ISO));
  const unitOfWork: InMemoryUnitOfWorkAdapter = new InMemoryUnitOfWorkAdapter({
    alarmRepository,
    deliveryRepository,
    expansionJobRepository,
  });
  const idGenerator: SequentialIdGenerator = new SequentialIdGenerator();
  const newWorker = (): ExpandRecipientsService =>
    new ExpandRecipientsService(unitOfWork, directory, idGenerator, new FixedClock());
  return {
    alarmRepository,
    unitOfWork,
    deliveryRepository,
    expansionJobRepository,
    directory,
    useCase: newWorker(),
    newWorker,
  };
};

const summaries = async (
  deliveryRepository: InMemoryDeliveryRepositoryAdapter,
): Promise<ReadonlyArray<DeliverySummary>> =>
  (await deliveryRepository.findByAlarmId(alarmId(ALARM_ID))).map(
    (delivery: Delivery): DeliverySummary => {
      const { recipientId, priority, state, createdAt }: DeliverySnapshot = delivery.snapshot();
      return { recipientId, priority, state, createdAt };
    },
  );

const pendingBulk = (recipientId: string): DeliverySummary => {
  const [owner]: ReadonlyArray<RecipientId> = recipientIds(recipientId);
  return {
    recipientId: owner,
    priority: 'BULK',
    state: { status: 'PENDING' },
    createdAt: new Date(EXPANDED_ISO),
  };
};

describe('ExpandRecipientsService', () => {
  it('UC-06 확장 대기 중인 대량 알림 / 확장 유스케이스가 사용자 API를 cursor 끝까지 읽는다 → 페이지마다 Delivery 생성과 cursor 저장이 한 트랜잭션으로 커밋된다', async (): Promise<void> => {
    const { deliveryRepository, expansionJobRepository, directory, useCase }: Fixture =
      await fixture(TWO_PAGES);

    const result: ExpansionResult = await useCase.execute(alarmId(ALARM_ID));

    expect(result).toEqual({ kind: 'completed' });
    expect(directory.requested).toEqual(['first', 'next:Mw']);
    expect(await summaries(deliveryRepository)).toEqual([
      pendingBulk('u_000001'),
      pendingBulk('u_000002'),
      pendingBulk('u_000003'),
    ]);
    expect(await expansionJobRepository.findByAlarmId(alarmId(ALARM_ID))).toEqual({
      kind: 'found',
      job: {
        alarmId: ALARM_ID,
        enqueuedAt: new Date(ENQUEUED_ISO),
        progress: { kind: 'completed', completedAt: new Date(EXPANDED_ISO) },
      },
    });
  });

  it('UC-06 한 페이지의 cursor 저장이 실패하면 그 페이지의 Delivery도 롤백되고 앞 페이지는 커밋된 채 남는다', async (): Promise<void> => {
    const { deliveryRepository, expansionJobRepository, useCase }: Fixture = await fixture(
      TWO_PAGES,
      new FailingOnSecondProgressRepository(),
    );

    await expect(useCase.execute(alarmId(ALARM_ID))).rejects.toThrow(
      'expansion progress storage is unavailable',
    );
    expect(await summaries(deliveryRepository)).toEqual([
      pendingBulk('u_000001'),
      pendingBulk('u_000002'),
    ]);
    expect(await expansionJobRepository.findByAlarmId(alarmId(ALARM_ID))).toMatchObject({
      job: { progress: { kind: 'in-progress', cursor: { kind: 'next', token: 'Mw' } } },
    });
  });

  it('UC-06 수신자가 0명이면 Delivery 없이 확장을 완료한다', async (): Promise<void> => {
    const { deliveryRepository, expansionJobRepository, useCase }: Fixture = await fixture([
      ['first', { recipientIds: [], next: { kind: 'end' } }],
    ]);

    expect(await useCase.execute(alarmId(ALARM_ID))).toEqual({ kind: 'completed' });
    expect(await summaries(deliveryRepository)).toEqual([]);
    expect(await expansionJobRepository.findByAlarmId(alarmId(ALARM_ID))).toMatchObject({
      job: { progress: { kind: 'completed' } },
    });
  });

  it('UC-06 이미 완료된 확장은 사용자 API를 다시 읽지 않는다', async (): Promise<void> => {
    const { directory, useCase }: Fixture = await fixture(TWO_PAGES);
    await useCase.execute(alarmId(ALARM_ID));

    expect(await useCase.execute(alarmId(ALARM_ID))).toEqual({ kind: 'completed' });
    expect(directory.requested).toEqual(['first', 'next:Mw']);
  });

  it('UC-06 확장 작업이 없는 알림은 not-found를 반환한다', async (): Promise<void> => {
    const { directory, useCase }: Fixture = await fixture(TWO_PAGES);

    expect(await useCase.execute(alarmId(MISSING_ALARM_ID))).toEqual({
      kind: 'not-found',
      alarmId: MISSING_ALARM_ID,
    });
    expect(directory.requested).toEqual([]);
  });

  it('UC-07 확장 도중 워커가 멈췄다 / 다른 워커가 확장을 이어받는다 → 저장된 cursor부터 이어서 읽고 같은 수신자의 Delivery는 중복 생성되지 않는다', async (): Promise<void> => {
    const { deliveryRepository, directory, useCase, newWorker }: Fixture = await fixture(
      TWO_PAGES,
      new InMemoryExpansionJobRepositoryAdapter(),
      new InMemoryAlarmRepositoryAdapter(),
      new FailingOnceDirectory(TWO_PAGES, 'next:Mw'),
    );
    await expect(useCase.execute(alarmId(ALARM_ID))).rejects.toThrow('user API is unavailable');

    const result: ExpansionResult = await newWorker().execute(alarmId(ALARM_ID));

    expect(result).toEqual({ kind: 'completed' });
    expect(directory.requested).toEqual(['first', 'next:Mw', 'next:Mw']);
    expect(await summaries(deliveryRepository)).toEqual([
      pendingBulk('u_000001'),
      pendingBulk('u_000002'),
      pendingBulk('u_000003'),
    ]);
  });

  it('UC-07 cursor 저장에 실패한 뒤 다른 워커가 이어받아도 Delivery는 중복 생성되지 않는다', async (): Promise<void> => {
    const { deliveryRepository, useCase, newWorker }: Fixture = await fixture(
      TWO_PAGES,
      new FailingOnSecondProgressRepository(),
    );
    await expect(useCase.execute(alarmId(ALARM_ID))).rejects.toThrow(
      'expansion progress storage is unavailable',
    );

    expect(await newWorker().execute(alarmId(ALARM_ID))).toEqual({ kind: 'completed' });
    expect(await summaries(deliveryRepository)).toEqual([
      pendingBulk('u_000001'),
      pendingBulk('u_000002'),
      pendingBulk('u_000003'),
    ]);
  });

  it('UC-07 같은 알림을 두 워커가 동시에 확장하면 한 워커만 진행하고 Delivery는 중복 생성되지 않는다', async (): Promise<void> => {
    const { deliveryRepository, useCase, newWorker }: Fixture = await fixture(TWO_PAGES);

    const results: ReadonlyArray<ExpansionResult> = await Promise.all([
      useCase.execute(alarmId(ALARM_ID)),
      newWorker().execute(alarmId(ALARM_ID)),
    ]);

    expect(results.map((result: ExpansionResult): string => result.kind).toSorted()).toEqual([
      'completed',
      'superseded',
    ]);
    expect(await summaries(deliveryRepository)).toEqual([
      pendingBulk('u_000001'),
      pendingBulk('u_000002'),
      pendingBulk('u_000003'),
    ]);
  });

  it('UC-08 확장 중 알림이 취소됐다 / 다음 페이지를 처리한다 → 확장을 멈추고 더 이상 Delivery를 만들지 않는다', async (): Promise<void> => {
    const alarmRepository: InMemoryAlarmRepositoryAdapter = new InMemoryAlarmRepositoryAdapter();
    const { deliveryRepository, expansionJobRepository, directory, useCase }: Fixture =
      await fixture(
        TWO_PAGES,
        new InMemoryExpansionJobRepositoryAdapter(),
        alarmRepository,
        new CancellingDirectory(TWO_PAGES, 'next:Mw', alarmRepository),
      );

    const result: ExpansionResult = await useCase.execute(alarmId(ALARM_ID));

    expect(result).toEqual({ kind: 'cancelled' });
    expect(directory.requested).toEqual(['first', 'next:Mw']);
    expect(await summaries(deliveryRepository)).toEqual([
      pendingBulk('u_000001'),
      pendingBulk('u_000002'),
    ]);
    expect(await expansionJobRepository.findByAlarmId(alarmId(ALARM_ID))).toMatchObject({
      job: { progress: { kind: 'stopped', stoppedAt: new Date(EXPANDED_ISO) } },
    });
  });

  it('UC-08 페이지 조회 중 취소 유스케이스가 실행되면 이미 만든 Delivery는 취소되고 새 Delivery는 만들어지지 않는다', async (): Promise<void> => {
    const directory: PausingDirectory = new PausingDirectory(TWO_PAGES, 'next:Mw');
    const { deliveryRepository, unitOfWork, useCase }: Fixture = await fixture(
      TWO_PAGES,
      new InMemoryExpansionJobRepositoryAdapter(),
      new InMemoryAlarmRepositoryAdapter(),
      directory,
    );
    const expansion: Promise<ExpansionResult> = useCase.execute(alarmId(ALARM_ID));
    await directory.paused.opened;

    await new CancelAlarmService(unitOfWork, new FixedClock()).execute(alarmId(ALARM_ID));
    directory.resumed.open();

    expect(await expansion).toEqual({ kind: 'cancelled' });
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
    const { alarmRepository, deliveryRepository, directory, useCase }: Fixture =
      await fixture(TWO_PAGES);
    await cancelStoredAlarm(alarmRepository);

    expect(await useCase.execute(alarmId(ALARM_ID))).toEqual({ kind: 'cancelled' });
    expect(directory.requested).toEqual([]);
    expect(await summaries(deliveryRepository)).toEqual([]);
  });

  it('UC-08 멈춘 확장은 다시 실행해도 사용자 API를 호출하지 않는다', async (): Promise<void> => {
    const { alarmRepository, directory, useCase, newWorker }: Fixture = await fixture(TWO_PAGES);
    await cancelStoredAlarm(alarmRepository);
    await useCase.execute(alarmId(ALARM_ID));

    expect(await newWorker().execute(alarmId(ALARM_ID))).toEqual({ kind: 'cancelled' });
    expect(directory.requested).toEqual([]);
  });
});
