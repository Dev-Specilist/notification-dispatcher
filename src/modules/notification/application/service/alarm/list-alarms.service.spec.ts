import { describe, expect, it } from 'vitest';
import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import {
  AlarmCreated,
  AlarmCreation,
  AlarmDraft,
  AlarmId,
  AlarmTransition,
} from '@/modules/notification/domain/alarm/alarm.type';
import {
  AlarmListPage,
  ListAlarmsQuery,
  ListAlarmsResult,
} from '@/modules/notification/application/port/driving/for-managing-alarms/list-alarms.type';
import { AlarmViewMapper } from '@/modules/notification/application/service/alarm/view/alarm-view.mapper';
import { ListAlarmsService } from '@/modules/notification/application/service/alarm/list-alarms.service';
import { InMemoryAlarmRepositoryAdapter } from '@/modules/notification/adapter/out/in-memory/in-memory-alarm-repository.adapter';
import { InMemoryDeliveryRepositoryAdapter } from '@/modules/notification/adapter/out/in-memory/in-memory-delivery-repository.adapter';
import { InMemoryExpansionJobRepositoryAdapter } from '@/modules/notification/adapter/out/in-memory/in-memory-expansion-job-repository.adapter';
import { InMemoryTransactionAdapter } from '@/modules/notification/adapter/out/in-memory/in-memory-transaction.adapter';
import { SnapshotOnlyTransaction } from '@/modules/notification/testing/snapshot-only-transaction';
import { UnusedTransaction } from '@/modules/notification/testing/unused-transaction';

interface Fixture {
  readonly alarmRepository: InMemoryAlarmRepositoryAdapter;
  readonly service: ListAlarmsService;
}

const OLDEST_BULK_DRAFT_ID: string = '00000000-0000-4000-8000-000000000001';
const MIDDLE_URGENT_DISPATCHING_ID: string = '00000000-0000-4000-8000-000000000002';
const NEWEST_URGENT_DRAFT_ID: string = '00000000-0000-4000-8000-000000000003';

const alarmId = (rawAlarmId: string): AlarmId => {
  if (!AlarmPredicates.isAlarmId(rawAlarmId)) {
    throw new Error(`test fixture ${rawAlarmId} is not a valid AlarmId`);
  }
  return rawAlarmId;
};

const draftAlarm = (rawAlarmId: string, draft: Readonly<AlarmDraft>, createdIso: string): Alarm => {
  const creation: AlarmCreation = Alarm.create(alarmId(rawAlarmId), draft, new Date(createdIso));
  if (creation.kind !== 'created') {
    throw new Error(`test fixture alarm is invalid: ${creation.error.code}`);
  }
  const { alarm }: AlarmCreated = creation;
  return alarm;
};

const dispatched = (alarm: Alarm): Alarm => {
  const transition: AlarmTransition = alarm.startDispatch(new Date('2026-10-08T09:05:00.000Z'));
  if (transition.kind !== 'transitioned') {
    throw new Error(`test fixture alarm cannot be dispatched: ${transition.error.code}`);
  }
  return transition.alarm;
};

const oldestBulkDraft: Alarm = draftAlarm(
  OLDEST_BULK_DRAFT_ID,
  { title: '추석 이벤트', body: '쿠폰 도착', kind: 'BULK', recipientIds: [] },
  '2026-10-08T09:00:00.000Z',
);
const middleUrgentDispatching: Alarm = dispatched(
  draftAlarm(
    MIDDLE_URGENT_DISPATCHING_ID,
    { title: '서버 점검', body: '10분 뒤 점검', kind: 'URGENT', recipientIds: ['u_000001'] },
    '2026-10-08T09:01:00.000Z',
  ),
);
const newestUrgentDraft: Alarm = draftAlarm(
  NEWEST_URGENT_DRAFT_ID,
  { title: '긴급 공지', body: '로그인 장애', kind: 'URGENT', recipientIds: ['u_000002'] },
  '2026-10-08T09:02:00.000Z',
);

const fixture = async (): Promise<Fixture> => {
  const alarmRepository: InMemoryAlarmRepositoryAdapter = new InMemoryAlarmRepositoryAdapter();
  await alarmRepository.save(oldestBulkDraft);
  await alarmRepository.save(middleUrgentDispatching);
  await alarmRepository.save(newestUrgentDraft);
  const transaction: InMemoryTransactionAdapter = new InMemoryTransactionAdapter({
    alarmRepository,
    deliveryRepository: new InMemoryDeliveryRepositoryAdapter(),
    expansionJobRepository: new InMemoryExpansionJobRepositoryAdapter(),
  });
  return {
    alarmRepository,
    service: new ListAlarmsService(new SnapshotOnlyTransaction(transaction)),
  };
};

const listed = (result: ListAlarmsResult): AlarmListPage => {
  if (result.kind !== 'page') {
    throw new Error(`expected page but got ${result.kind}`);
  }
  return result;
};

const DRAFT_ONLY_FIRST_PAGE: ListAlarmsQuery = {
  status: { kind: 'exactly', value: 'DRAFT' },
  alarmKind: { kind: 'any' },
  start: { kind: 'newest' },
  limit: 1,
};

describe('ListAlarmsService', () => {
  it('UC-17 상태·종류가 다른 알림 여러 개 / 목록 조회 유스케이스 → 필터에 맞는 알림을 생성 역순으로 한 페이지 반환하고, 더 있으면 다음 시작 위치를 함께 반환한다', async (): Promise<void> => {
    const { service }: Fixture = await fixture();

    const { items, next }: AlarmListPage = listed(await service.execute(DRAFT_ONLY_FIRST_PAGE));

    expect(items).toEqual([AlarmViewMapper.toView(newestUrgentDraft)]);
    expect(next).toEqual({
      kind: 'more',
      after: { createdAt: new Date('2026-10-08T09:02:00.000Z'), alarmId: NEWEST_URGENT_DRAFT_ID },
    });
  });

  it('UC-17 다음 시작 위치부터 이어서 조회하면 남은 알림을 주고 마지막 페이지임을 알린다', async (): Promise<void> => {
    const { service }: Fixture = await fixture();

    const { items, next }: AlarmListPage = listed(
      await service.execute({
        ...DRAFT_ONLY_FIRST_PAGE,
        start: {
          kind: 'after',
          position: {
            createdAt: new Date('2026-10-08T09:02:00.000Z'),
            alarmId: NEWEST_URGENT_DRAFT_ID,
          },
        },
      }),
    );

    expect(items).toEqual([AlarmViewMapper.toView(oldestBulkDraft)]);
    expect(next).toEqual({ kind: 'last' });
  });

  it('UC-17 종류 필터만 주면 그 종류의 알림을 상태와 관계없이 생성 역순으로 준다', async (): Promise<void> => {
    const { service }: Fixture = await fixture();

    const { items, next }: AlarmListPage = listed(
      await service.execute({
        status: { kind: 'any' },
        alarmKind: { kind: 'exactly', value: 'URGENT' },
        start: { kind: 'newest' },
        limit: 10,
      }),
    );

    expect(items).toEqual([
      AlarmViewMapper.toView(newestUrgentDraft),
      AlarmViewMapper.toView(middleUrgentDispatching),
    ]);
    expect(next).toEqual({ kind: 'last' });
  });

  it('시작 위치의 알림 id 형식이 틀리면 저장소를 거치지 않고 잘못된 cursor로 거절한다', async (): Promise<void> => {
    const service: ListAlarmsService = new ListAlarmsService(new UnusedTransaction());

    const result: ListAlarmsResult = await service.execute({
      ...DRAFT_ONLY_FIRST_PAGE,
      start: {
        kind: 'after',
        position: { createdAt: new Date('2026-10-08T09:02:00.000Z'), alarmId: 'not-a-uuid' },
      },
    });

    expect(result).toEqual({ kind: 'rejected', error: { code: 'INVALID_CURSOR' } });
  });

  it('시작 위치의 생성 시각이 유효한 시각이 아니면 저장소를 거치지 않고 잘못된 cursor로 거절한다', async (): Promise<void> => {
    const service: ListAlarmsService = new ListAlarmsService(new UnusedTransaction());

    const result: ListAlarmsResult = await service.execute({
      ...DRAFT_ONLY_FIRST_PAGE,
      start: {
        kind: 'after',
        position: { createdAt: new Date('invalid-date'), alarmId: NEWEST_URGENT_DRAFT_ID },
      },
    });

    expect(result).toEqual({ kind: 'rejected', error: { code: 'INVALID_CURSOR' } });
  });

  it('페이지 크기가 1 이상의 정수가 아니면 저장소를 거치지 않고 잘못된 크기로 거절한다', async (): Promise<void> => {
    const service: ListAlarmsService = new ListAlarmsService(new UnusedTransaction());

    const result: ListAlarmsResult = await service.execute({ ...DRAFT_ONLY_FIRST_PAGE, limit: 0 });

    expect(result).toEqual({ kind: 'rejected', error: { code: 'INVALID_LIMIT', limit: 0 } });
  });
});
