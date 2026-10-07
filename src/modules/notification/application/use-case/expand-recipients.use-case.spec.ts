import { describe, expect, it } from 'vitest';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { AlarmId, RecipientId } from '@/modules/notification/domain/alarm/alarm.type';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import { DeliveryId, DeliverySnapshot } from '@/modules/notification/domain/delivery/delivery.type';
import { ClockPort } from '@/modules/notification/application/port/clock.port';
import { ExpansionProgress } from '@/modules/notification/application/port/expansion-job-repository.type';
import { IdGeneratorPort } from '@/modules/notification/application/port/id-generator.port';
import { RecipientDirectoryPort } from '@/modules/notification/application/port/recipient-directory.port';
import {
  PageCursor,
  RecipientPage,
} from '@/modules/notification/application/port/recipient-directory.type';
import { ExpansionResult } from '@/modules/notification/application/use-case/expand-recipients.type';
import { ExpandRecipientsUseCase } from '@/modules/notification/application/use-case/expand-recipients.use-case';
import { InMemoryAlarmRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-alarm-repository.adapter';
import { InMemoryDeliveryRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-delivery-repository.adapter';
import { InMemoryExpansionJobRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-expansion-job-repository.adapter';
import { InMemoryUnitOfWorkAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-unit-of-work.adapter';

type PageEntry = Readonly<[string, RecipientPage]>;

interface PageFound {
  readonly kind: 'found';
  readonly page: RecipientPage;
}

interface PageMissing {
  readonly kind: 'missing';
}

type PageLookup = PageFound | PageMissing;

type DeliverySummary = Pick<DeliverySnapshot, 'recipientId' | 'priority' | 'state' | 'createdAt'>;

interface Fixture {
  readonly deliveryRepository: InMemoryDeliveryRepositoryAdapter;
  readonly expansionJobRepository: InMemoryExpansionJobRepositoryAdapter;
  readonly directory: PagedRecipientDirectory;
  readonly useCase: ExpandRecipientsUseCase;
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
      pages.map(([key, page]: PageEntry): Readonly<[string, PageFound]> => [
        key,
        { kind: 'found', page },
      ]),
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
): Promise<Fixture> => {
  const deliveryRepository: InMemoryDeliveryRepositoryAdapter =
    new InMemoryDeliveryRepositoryAdapter();
  await expansionJobRepository.enqueue(alarmId(ALARM_ID), new Date(ENQUEUED_ISO));
  const unitOfWork: InMemoryUnitOfWorkAdapter = new InMemoryUnitOfWorkAdapter({
    alarmRepository: new InMemoryAlarmRepositoryAdapter(),
    deliveryRepository,
    expansionJobRepository,
  });
  const directory: PagedRecipientDirectory = new PagedRecipientDirectory(pages);
  return {
    deliveryRepository,
    expansionJobRepository,
    directory,
    useCase: new ExpandRecipientsUseCase(
      unitOfWork,
      directory,
      new SequentialIdGenerator(),
      new FixedClock(),
    ),
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

describe('ExpandRecipientsUseCase', () => {
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

  it.todo(
    'UC-07 확장 도중 워커가 멈췄다 / 다른 워커가 확장을 이어받는다 → 저장된 cursor부터 이어서 읽고 같은 수신자의 Delivery는 중복 생성되지 않는다',
  );
  it.todo(
    'UC-08 확장 중 알림이 취소됐다 / 다음 페이지를 처리한다 → 확장을 멈추고 더 이상 Delivery를 만들지 않는다',
  );
});
