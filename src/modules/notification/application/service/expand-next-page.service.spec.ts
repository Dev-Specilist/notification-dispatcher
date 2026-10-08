import { describe, expect, it } from 'vitest';
import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import {
  AlarmCreation,
  AlarmId,
  AlarmTransition,
  RecipientId,
} from '@/modules/notification/domain/alarm/alarm.type';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import { DeliveryId } from '@/modules/notification/domain/delivery/delivery.type';
import { ClockPort } from '@/modules/notification/application/port/out/clock.port';
import { DeliveryIdGeneratorPort } from '@/modules/notification/application/port/out/delivery-id-generator.port';
import { ExpansionSettingsPort } from '@/modules/notification/application/port/out/expansion-settings.port';
import { RecipientDirectoryPort } from '@/modules/notification/application/port/out/recipient-directory.port';
import {
  PageCursor,
  RecipientPage,
} from '@/modules/notification/application/port/out/recipient-directory.type';
import { ExpansionPageAttempt } from '@/modules/notification/application/port/in/expand-next-page.type';
import { ExpandNextPageService } from '@/modules/notification/application/service/expand-next-page.service';
import { InMemoryAlarmRepositoryAdapter } from '@/modules/notification/adapter/out/in-memory/in-memory-alarm-repository.adapter';
import { InMemoryDeliveryRepositoryAdapter } from '@/modules/notification/adapter/out/in-memory/in-memory-delivery-repository.adapter';
import { InMemoryExpansionJobRepositoryAdapter } from '@/modules/notification/adapter/out/in-memory/in-memory-expansion-job-repository.adapter';
import { InMemoryTransactionAdapter } from '@/modules/notification/adapter/out/in-memory/in-memory-transaction.adapter';
import { DurationPredicates } from '@/shared/domain/duration.predicate';
import { DurationMs } from '@/shared/domain/duration.type';

interface Fixture {
  readonly deliveryRepository: InMemoryDeliveryRepositoryAdapter;
  readonly expansionJobRepository: InMemoryExpansionJobRepositoryAdapter;
  readonly clock: MovableClock;
  readonly service: ExpandNextPageService;
  readonly newWorker: () => ExpandNextPageService;
}

const OLDER_ALARM_ID: string = '0b6c1b4e-9a37-4c2a-8d6a-2f6b2d7f1a10';
const NEWER_ALARM_ID: string = '7d3f1e2a-4b5c-4d6e-8f70-1a2b3c4d5e6f';
const OLDER_ENQUEUED_ISO: string = '2026-10-07T09:05:00.000Z';
const NEWER_ENQUEUED_ISO: string = '2026-10-07T09:05:10.000Z';
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

const dispatchedBulkAlarm = (rawAlarmId: string): Alarm => {
  const creation: AlarmCreation = Alarm.create(
    alarmId(rawAlarmId),
    { title: '추석 이벤트', body: '쿠폰 도착', kind: 'BULK', recipientIds: [] },
    new Date('2026-10-07T09:00:00.000Z'),
  );
  if (creation.kind !== 'created') {
    throw new Error(`test fixture alarm is invalid: ${creation.error.code}`);
  }
  const transition: AlarmTransition = creation.alarm.startDispatch(new Date(OLDER_ENQUEUED_ISO));
  if (transition.kind !== 'transitioned') {
    throw new Error(`test fixture alarm cannot be dispatched: ${transition.error.code}`);
  }
  return transition.alarm;
};

class MovableClock implements ClockPort {
  private current: Date = new Date(EXPANDED_ISO);

  now(): Date {
    return new Date(this.current.getTime());
  }

  moveTo(iso: string): void {
    this.current = new Date(iso);
  }
}

class TwoPageDirectory implements RecipientDirectoryPort {
  readonly requestedCursors: Array<PageCursor> = [];

  fetchPage(cursor: PageCursor): Promise<RecipientPage> {
    this.requestedCursors.push(cursor);
    return Promise.resolve(
      cursor.kind === 'first'
        ? {
            recipientIds: recipientIds('u_000001', 'u_000002'),
            next: { kind: 'next', token: 'Mw' },
          }
        : { recipientIds: recipientIds('u_000003'), next: { kind: 'end' } },
    );
  }
}

class FailingOnceDirectory extends TwoPageDirectory {
  private failed: boolean = false;

  override fetchPage(cursor: PageCursor): Promise<RecipientPage> {
    if (!this.failed) {
      this.failed = true;
      return Promise.reject(new Error('user api is unreachable'));
    }
    return super.fetchPage(cursor);
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

class FixedExpansionSettings implements ExpansionSettingsPort {
  readonly leaseMs: DurationMs = FixedExpansionSettings.durationMs(LEASE_MS);

  private static durationMs(rawDurationMs: number): DurationMs {
    if (!DurationPredicates.isDurationMs(rawDurationMs)) {
      throw new Error(`test fixture ${rawDurationMs} is not a valid DurationMs`);
    }
    return rawDurationMs;
  }
}

const fixture = async (
  directory: RecipientDirectoryPort,
  enqueuedAlarmIds: ReadonlyArray<string>,
): Promise<Fixture> => {
  const alarmRepository: InMemoryAlarmRepositoryAdapter = new InMemoryAlarmRepositoryAdapter();
  const deliveryRepository: InMemoryDeliveryRepositoryAdapter =
    new InMemoryDeliveryRepositoryAdapter();
  const expansionJobRepository: InMemoryExpansionJobRepositoryAdapter =
    new InMemoryExpansionJobRepositoryAdapter();
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
  return { deliveryRepository, expansionJobRepository, clock, service: newWorker(), newWorker };
};

describe('ExpandNextPageService', () => {
  it('UC-18 진행 중인 확장 작업이 없으면 아무것도 하지 않는다', async (): Promise<void> => {
    const { service }: Fixture = await fixture(new TwoPageDirectory(), []);

    expect(await service.execute()).toEqual({ kind: 'idle' });
  });

  it('UC-18 진행 중인 확장 작업 여러 개 / 다음 확장 페이지 유스케이스 → 잡을 수 있는 작업 하나의 한 페이지만 처리하고 진행을 기록해, 다음 페이지는 다른 워커도 이어받을 수 있다', async (): Promise<void> => {
    const directory: TwoPageDirectory = new TwoPageDirectory();
    const { deliveryRepository, newWorker }: Fixture = await fixture(directory, [OLDER_ALARM_ID]);

    const firstPageAttempt: ExpansionPageAttempt = await newWorker().execute();
    const deliveriesAfterFirstPage: number = (
      await deliveryRepository.findByAlarmId(alarmId(OLDER_ALARM_ID))
    ).length;
    const secondPageAttempt: ExpansionPageAttempt = await newWorker().execute();

    expect(firstPageAttempt).toEqual({
      kind: 'expanded',
      alarmId: OLDER_ALARM_ID,
      step: 'continued',
    });
    expect(deliveriesAfterFirstPage).toBe(2);
    expect(secondPageAttempt).toEqual({
      kind: 'expanded',
      alarmId: OLDER_ALARM_ID,
      step: 'completed',
    });
    expect(directory.requestedCursors).toEqual([{ kind: 'first' }, { kind: 'next', token: 'Mw' }]);
    expect(await deliveryRepository.findByAlarmId(alarmId(OLDER_ALARM_ID))).toHaveLength(3);
  });

  it('UC-18 다른 워커가 lease로 잡고 있는 확장 작업은 건너뛰고 다음 작업을 처리한다', async (): Promise<void> => {
    const { expansionJobRepository, service }: Fixture = await fixture(new TwoPageDirectory(), [
      OLDER_ALARM_ID,
      NEWER_ALARM_ID,
    ]);
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
    const { clock, service }: Fixture = await fixture(new FailingOnceDirectory(), [OLDER_ALARM_ID]);

    await expect(service.execute()).rejects.toThrow('user api is unreachable');
    clock.moveTo(BEFORE_LEASE_EXPIRY_ISO);
    const attemptBeforeExpiry: ExpansionPageAttempt = await service.execute();
    clock.moveTo(AFTER_LEASE_EXPIRY_ISO);
    const attemptAfterExpiry: ExpansionPageAttempt = await service.execute();

    expect(attemptBeforeExpiry).toEqual({ kind: 'idle' });
    expect(attemptAfterExpiry).toEqual({
      kind: 'expanded',
      alarmId: OLDER_ALARM_ID,
      step: 'continued',
    });
  });
});
