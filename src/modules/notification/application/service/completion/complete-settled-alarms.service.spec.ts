import { describe, expect, it } from 'vitest';
import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import {
  AlarmCreation,
  AlarmId,
  AlarmKind,
  AlarmStatus,
  AlarmTransition,
  RecipientId,
} from '@/modules/notification/domain/alarm/alarm.type';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import { DeliveryId } from '@/modules/notification/domain/delivery/delivery.type';
import { AlarmLookup } from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.type';
import { ClockPort } from '@/modules/notification/application/port/driven/for-telling-time/clock.port';
import { TransactionPort } from '@/modules/notification/application/port/driven/for-running-transactions/transaction.port';
import { AlarmCommand } from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-command.type';
import { CompleteAlarmResult } from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-result.type';
import { CompleteAlarmIfSettledUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/complete-alarm-if-settled.use-case';
import { SettledAlarmsPageChecked } from '@/modules/notification/application/port/driving/for-dispatching-alarms/complete-settled-alarms.type';
import { ListStart } from '@/modules/notification/application/port/driving/for-managing-alarms/list-alarms.type';
import { CompleteAlarmIfSettledService } from '@/modules/notification/application/service/completion/complete-alarm-if-settled.service';
import { CompleteSettledAlarmsService } from '@/modules/notification/application/service/completion/complete-settled-alarms.service';
import { InMemoryAlarmRepositoryAdapter } from '@/modules/notification/testing/in-memory/in-memory-alarm-repository.adapter';
import { InMemoryDeliveryRepositoryAdapter } from '@/modules/notification/testing/in-memory/in-memory-delivery-repository.adapter';
import { InMemoryExpansionJobRepositoryAdapter } from '@/modules/notification/testing/in-memory/in-memory-expansion-job-repository.adapter';
import { InMemoryTransactionAdapter } from '@/modules/notification/testing/in-memory/in-memory-transaction.adapter';

interface Fixture {
  readonly alarmRepository: InMemoryAlarmRepositoryAdapter;
  readonly deliveryRepository: InMemoryDeliveryRepositoryAdapter;
  readonly expansionJobRepository: InMemoryExpansionJobRepositoryAdapter;
  readonly service: CompleteSettledAlarmsService;
}

const CREATED_ISO: string = '2026-10-08T09:00:00.000Z';
const DISPATCHED_ISO: string = '2026-10-08T09:01:00.000Z';
const NOW_ISO: string = '2026-10-08T09:30:00.000Z';
const PAGE_SIZE: number = 100;
const MORE_THAN_ONE_PAGE: number = PAGE_SIZE + 1;

const at = (iso: string): Date => new Date(iso);

const alarmIdAt = (index: number): AlarmId => {
  const rawAlarmId: string = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  if (!AlarmPredicates.isAlarmId(rawAlarmId)) {
    throw new Error(`test fixture ${rawAlarmId} is not a valid AlarmId`);
  }
  return rawAlarmId;
};

const recipientId = (): RecipientId => {
  const rawRecipientId: string = 'u_000001';
  if (!AlarmPredicates.isRecipientId(rawRecipientId)) {
    throw new Error(`test fixture ${rawRecipientId} is not a valid RecipientId`);
  }
  return rawRecipientId;
};

const deliveryId = (): DeliveryId => {
  const rawDeliveryId: string = '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7caa';
  if (!DeliveryPredicates.isDeliveryId(rawDeliveryId)) {
    throw new Error(`test fixture ${rawDeliveryId} is not a valid DeliveryId`);
  }
  return rawDeliveryId;
};

const draftAlarm = (alarmId: AlarmId, kind: AlarmKind): Alarm => {
  const creation: AlarmCreation = Alarm.create(
    alarmId,
    {
      title: '서버 점검',
      body: '10분 뒤 점검',
      kind,
      recipientIds: kind === 'URGENT' ? ['u_000001'] : [],
    },
    at(CREATED_ISO),
  );
  if (creation.kind !== 'created') {
    throw new Error(`test fixture alarm is invalid: ${creation.error.code}`);
  }
  return creation.alarm;
};

const dispatched = (alarm: Alarm): Alarm => {
  const transition: AlarmTransition = alarm.startDispatch(at(DISPATCHED_ISO));
  if (transition.kind !== 'transitioned') {
    throw new Error(`test fixture alarm cannot be dispatched: ${transition.error.code}`);
  }
  return transition.alarm;
};

const pendingDelivery = (alarmId: AlarmId): Delivery =>
  Delivery.create(
    { id: deliveryId(), alarmId, recipientId: recipientId(), priority: 'URGENT' },
    at(DISPATCHED_ISO),
  );

class FailingCompletionFor implements CompleteAlarmIfSettledUseCase {
  constructor(
    private readonly completeAlarmIfSettled: CompleteAlarmIfSettledUseCase,
    private readonly failingAlarmIds: ReadonlyArray<string>,
  ) {}

  execute(command: Readonly<AlarmCommand>): Promise<CompleteAlarmResult> {
    if (this.failingAlarmIds.includes(command.alarmId)) {
      return Promise.reject(new Error('database connection reset'));
    }
    return this.completeAlarmIfSettled.execute(command);
  }
}

class FixedClock implements ClockPort {
  now(): Date {
    return at(NOW_ISO);
  }
}

const fixture = (failingAlarmIds: ReadonlyArray<string> = []): Fixture => {
  const alarmRepository: InMemoryAlarmRepositoryAdapter = new InMemoryAlarmRepositoryAdapter();
  const deliveryRepository: InMemoryDeliveryRepositoryAdapter =
    new InMemoryDeliveryRepositoryAdapter();
  const expansionJobRepository: InMemoryExpansionJobRepositoryAdapter =
    new InMemoryExpansionJobRepositoryAdapter();
  const transaction: TransactionPort = new InMemoryTransactionAdapter({
    alarmRepository,
    deliveryRepository,
    expansionJobRepository,
  });
  return {
    alarmRepository,
    deliveryRepository,
    expansionJobRepository,
    service: new CompleteSettledAlarmsService(
      transaction,
      new FailingCompletionFor(
        new CompleteAlarmIfSettledService(transaction, new FixedClock()),
        failingAlarmIds,
      ),
    ),
  };
};

const storedStatus = async (
  alarmRepository: InMemoryAlarmRepositoryAdapter,
  alarmId: AlarmId,
): Promise<AlarmStatus> => {
  const lookup: AlarmLookup = await alarmRepository.findById(alarmId);
  if (lookup.kind !== 'found') {
    throw new Error(`expected alarm ${alarmId} to be stored`);
  }
  return lookup.alarm.snapshot().state.status;
};

const checkAllPages = async (
  service: CompleteSettledAlarmsService,
): Promise<ReadonlyArray<SettledAlarmsPageChecked>> => {
  const checkedPages: Array<SettledAlarmsPageChecked> = [];
  let start: ListStart = { kind: 'newest' };
  let checkedPage: SettledAlarmsPageChecked;
  do {
    checkedPage = await service.execute({ start });
    checkedPages.push(checkedPage);
    if (checkedPage.next.kind === 'more') {
      start = { kind: 'after', position: checkedPage.next.after };
    }
  } while (checkedPage.next.kind === 'more');
  return checkedPages;
};

const checkedAlarmTotal = (checkedPages: ReadonlyArray<SettledAlarmsPageChecked>): number =>
  checkedPages.reduce(
    (total: number, { checkedAlarmCount }: SettledAlarmsPageChecked): number =>
      total + checkedAlarmCount,
    0,
  );

const completedAlarmTotal = (checkedPages: ReadonlyArray<SettledAlarmsPageChecked>): number =>
  checkedPages.reduce(
    (total: number, { completedAlarmCount }: SettledAlarmsPageChecked): number =>
      total + completedAlarmCount,
    0,
  );

describe('CompleteSettledAlarmsService', () => {
  it('UC-19 발송 중인 알림 여러 개 / 완료 확인 유스케이스 → 발송 중인 알림을 모두 확인해 확장이 끝나고 미종결 Delivery가 없는 알림만 COMPLETED로 바꾼다', async (): Promise<void> => {
    const { alarmRepository, deliveryRepository, expansionJobRepository, service }: Fixture =
      fixture();
    const settledAlarmIds: Array<AlarmId> = [];
    for (let index: number = 1; index <= MORE_THAN_ONE_PAGE; index += 1) {
      settledAlarmIds.push(alarmIdAt(index));
      await alarmRepository.save(dispatched(draftAlarm(alarmIdAt(index), 'URGENT')));
    }
    const unsettledAlarmId: AlarmId = alarmIdAt(MORE_THAN_ONE_PAGE + 1);
    await alarmRepository.save(dispatched(draftAlarm(unsettledAlarmId, 'URGENT')));
    await deliveryRepository.saveAll([pendingDelivery(unsettledAlarmId)]);
    const expandingAlarmId: AlarmId = alarmIdAt(MORE_THAN_ONE_PAGE + 2);
    await alarmRepository.save(dispatched(draftAlarm(expandingAlarmId, 'BULK')));
    await expansionJobRepository.enqueue(expandingAlarmId, at(DISPATCHED_ISO));
    const draftAlarmId: AlarmId = alarmIdAt(MORE_THAN_ONE_PAGE + 3);
    await alarmRepository.save(draftAlarm(draftAlarmId, 'URGENT'));

    const checkedPages: ReadonlyArray<SettledAlarmsPageChecked> = await checkAllPages(service);

    expect(
      checkedPages.map(
        ({ checkedAlarmCount }: SettledAlarmsPageChecked): number => checkedAlarmCount,
      ),
    ).toEqual([PAGE_SIZE, 3]);
    expect(checkedAlarmTotal(checkedPages)).toBe(MORE_THAN_ONE_PAGE + 2);
    expect(completedAlarmTotal(checkedPages)).toBe(MORE_THAN_ONE_PAGE);
    for (const settledAlarmId of settledAlarmIds) {
      expect(await storedStatus(alarmRepository, settledAlarmId)).toBe('COMPLETED');
    }
    expect(await storedStatus(alarmRepository, unsettledAlarmId)).toBe('DISPATCHING');
    expect(await storedStatus(alarmRepository, expandingAlarmId)).toBe('DISPATCHING');
    expect(await storedStatus(alarmRepository, draftAlarmId)).toBe('DRAFT');
  });

  it('UC-19 발송 중인 알림이 없으면 아무것도 바꾸지 않는다', async (): Promise<void> => {
    const { service }: Fixture = fixture();

    expect(await service.execute({ start: { kind: 'newest' } })).toEqual({
      kind: 'checked',
      checkedAlarmCount: 0,
      completedAlarmCount: 0,
      failures: [],
      next: { kind: 'last' },
    });
  });

  it('UC-19 한 번 실행하면 한 페이지만 확인하고 다음 페이지의 시작 위치를 돌려준다', async (): Promise<void> => {
    const { alarmRepository, service }: Fixture = fixture();
    for (let index: number = 1; index <= MORE_THAN_ONE_PAGE; index += 1) {
      await alarmRepository.save(dispatched(draftAlarm(alarmIdAt(index), 'URGENT')));
    }

    const firstPage: SettledAlarmsPageChecked = await service.execute({
      start: { kind: 'newest' },
    });

    expect(firstPage).toMatchObject({
      checkedAlarmCount: PAGE_SIZE,
      completedAlarmCount: PAGE_SIZE,
      next: { kind: 'more' },
    });
  });

  it('UC-19 알림 하나의 완료 판정이 실패해도 나머지 알림을 계속 확인하고 실패한 알림을 알려준다', async (): Promise<void> => {
    const failingAlarmId: AlarmId = alarmIdAt(2);
    const { alarmRepository, service }: Fixture = fixture([failingAlarmId]);
    for (let index: number = 1; index <= 3; index += 1) {
      await alarmRepository.save(dispatched(draftAlarm(alarmIdAt(index), 'URGENT')));
    }

    const checkedPage: SettledAlarmsPageChecked = await service.execute({
      start: { kind: 'newest' },
    });

    expect(checkedPage).toMatchObject({
      checkedAlarmCount: 3,
      completedAlarmCount: 2,
      failures: [{ alarmId: failingAlarmId, reason: 'database connection reset' }],
    });
    expect(await storedStatus(alarmRepository, alarmIdAt(1))).toBe('COMPLETED');
    expect(await storedStatus(alarmRepository, failingAlarmId)).toBe('DISPATCHING');
    expect(await storedStatus(alarmRepository, alarmIdAt(3))).toBe('COMPLETED');
  });
});
