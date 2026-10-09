import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import {
  AlarmCompletion,
  AlarmCreation,
  AlarmDraft,
  AlarmId,
  AlarmSnapshot,
  AlarmTransition,
} from '@/modules/notification/domain/alarm/alarm.type';
import { AlarmRepositoryPort } from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.port';
import { AlarmRepositoryPredicates } from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.predicate';
import {
  AlarmLookup,
  AlarmPage,
  AlarmPageNext,
  AlarmPageQuery,
  AlarmPageStart,
  PageSize,
} from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.type';
import { KindAssertion, KindMember } from '@/shared/testing/kind.assertion';

type ContractAlarmRepository = AlarmRepositoryPort;

type AlarmRepositoryFactory = () => Promise<ContractAlarmRepository>;

interface PageSummary {
  readonly ids: ReadonlyArray<string>;
  readonly next: AlarmPageNext;
}

type StateCase = Readonly<[string, (alarm: Alarm) => Alarm]>;

const CREATED_ISO: string = '2026-10-08T09:00:00.123Z';
const DISPATCHED_ISO: string = '2026-10-08T09:05:00.456Z';
const CANCELLED_ISO: string = '2026-10-08T09:10:00.789Z';
const COMPLETED_ISO: string = '2026-10-08T09:20:00.321Z';

const URGENT_DRAFT: AlarmDraft = {
  title: '서버 점검',
  body: '10분 뒤 점검이 시작됩니다',
  kind: 'URGENT',
  recipientIds: ['u_000002', 'u_000001'],
};

const BULK_DRAFT: AlarmDraft = {
  title: '추석 이벤트',
  body: '연휴 쿠폰이 도착했어요',
  kind: 'BULK',
  recipientIds: [],
};

export class AlarmRepositoryContract {
  static verify(createRepository: AlarmRepositoryFactory): void {
    it('DB-01 알림 저장소 / 저장 후 id로 조회한다 → 같은 도메인 객체로 복원된다', async (): Promise<void> => {
      const repository: ContractAlarmRepository = await createRepository();
      const urgent: Alarm = AlarmRepositoryContract.dispatched(
        AlarmRepositoryContract.created(URGENT_DRAFT),
      );
      const bulk: Alarm = AlarmRepositoryContract.created(BULK_DRAFT);

      await repository.save(urgent);
      await repository.save(bulk);

      expect(
        AlarmRepositoryContract.found(await repository.findById(urgent.snapshot().id)).snapshot(),
      ).toEqual(urgent.snapshot());
      expect(
        AlarmRepositoryContract.found(await repository.findById(bulk.snapshot().id)).snapshot(),
      ).toEqual(bulk.snapshot());
    });

    it.each<StateCase>([
      ['DISPATCHING', (alarm: Alarm): Alarm => AlarmRepositoryContract.dispatched(alarm)],
      [
        'COMPLETED',
        (alarm: Alarm): Alarm =>
          AlarmRepositoryContract.completed(AlarmRepositoryContract.dispatched(alarm)),
      ],
      [
        'CANCELLED(발송 전)',
        (alarm: Alarm): Alarm =>
          AlarmRepositoryContract.transitioned(alarm.cancel(new Date(CANCELLED_ISO))),
      ],
      [
        'CANCELLED(발송 중)',
        (alarm: Alarm): Alarm =>
          AlarmRepositoryContract.transitioned(
            AlarmRepositoryContract.dispatched(alarm).cancel(new Date(CANCELLED_ISO)),
          ),
      ],
    ])(
      'DB-01 %s 알림을 처음 저장해도 상태와 시각이 그대로 복원된다',
      async (_status: string, advance: (alarm: Alarm) => Alarm): Promise<void> => {
        const repository: ContractAlarmRepository = await createRepository();
        const alarm: Alarm = advance(AlarmRepositoryContract.created(URGENT_DRAFT));

        await repository.save(alarm);

        expect(
          AlarmRepositoryContract.found(await repository.findById(alarm.snapshot().id)).snapshot(),
        ).toEqual(alarm.snapshot());
      },
    );

    it('DB-01 저장하지 않은 id로 조회하면 없음으로 돌려준다', async (): Promise<void> => {
      const repository: ContractAlarmRepository = await createRepository();

      expect(await repository.findById(AlarmRepositoryContract.newAlarmId())).toEqual({
        kind: 'missing',
      });
    });

    it('DB-01 상태가 바뀐 알림을 다시 저장하면 마지막 상태로 조회된다', async (): Promise<void> => {
      const repository: ContractAlarmRepository = await createRepository();
      const draft: Alarm = AlarmRepositoryContract.created(URGENT_DRAFT);
      const dispatching: Alarm = AlarmRepositoryContract.dispatched(draft);
      const cancelled: Alarm = AlarmRepositoryContract.transitioned(
        dispatching.cancel(new Date(CANCELLED_ISO)),
      );

      await repository.save(draft);
      await repository.save(dispatching);
      await repository.save(cancelled);

      expect(
        AlarmRepositoryContract.found(await repository.findById(draft.snapshot().id)).snapshot(),
      ).toEqual(cancelled.snapshot());
    });

    it('DB-04 잠그며 조회해도 저장된 알림을 같은 도메인 객체로 돌려준다', async (): Promise<void> => {
      const repository: ContractAlarmRepository = await createRepository();
      const alarm: Alarm = AlarmRepositoryContract.dispatched(
        AlarmRepositoryContract.created(URGENT_DRAFT),
      );
      await repository.save(alarm);

      expect(
        AlarmRepositoryContract.found(
          await repository.findByIdForUpdate(alarm.snapshot().id),
        ).snapshot(),
      ).toEqual(alarm.snapshot());
    });

    it('DB-04 저장하지 않은 id를 잠그며 조회하면 없음으로 돌려준다', async (): Promise<void> => {
      const repository: ContractAlarmRepository = await createRepository();

      expect(await repository.findByIdForUpdate(AlarmRepositoryContract.newAlarmId())).toEqual({
        kind: 'missing',
      });
    });

    it('DB-20 공유 잠금으로 조회해도 저장된 알림을 같은 도메인 객체로 돌려준다', async (): Promise<void> => {
      const repository: ContractAlarmRepository = await createRepository();
      const alarm: Alarm = AlarmRepositoryContract.dispatched(
        AlarmRepositoryContract.created(URGENT_DRAFT),
      );
      await repository.save(alarm);

      expect(
        AlarmRepositoryContract.found(
          await repository.findByIdForShare(alarm.snapshot().id),
        ).snapshot(),
      ).toEqual(alarm.snapshot());
    });

    it('DB-20 저장하지 않은 id를 공유 잠금으로 조회하면 없음으로 돌려준다', async (): Promise<void> => {
      const repository: ContractAlarmRepository = await createRepository();

      expect(await repository.findByIdForShare(AlarmRepositoryContract.newAlarmId())).toEqual({
        kind: 'missing',
      });
    });

    it('DB-01 조회한 알림의 Date를 바꿔도 저장된 값은 바뀌지 않는다', async (): Promise<void> => {
      const repository: ContractAlarmRepository = await createRepository();
      const alarm: Alarm = AlarmRepositoryContract.created(BULK_DRAFT);
      await repository.save(alarm);

      AlarmRepositoryContract.found(await repository.findById(alarm.snapshot().id))
        .snapshot()
        .createdAt.setUTCFullYear(1990);

      expect(
        AlarmRepositoryContract.found(await repository.findById(alarm.snapshot().id)).snapshot()
          .createdAt,
      ).toEqual(new Date(CREATED_ISO));
    });

    it('DB-02 알림 여러 개 / 상태·종류 필터와 cursor로 목록을 조회한다 → 생성 역순으로 페이지가 나뉘고 다음 cursor가 반환된다', async (): Promise<void> => {
      const repository: ContractAlarmRepository = await createRepository();
      const oldestDraftBulk: Alarm = AlarmRepositoryContract.createdAtMinute(BULK_DRAFT, 1);
      const draftUrgent: Alarm = AlarmRepositoryContract.createdAtMinute(URGENT_DRAFT, 2);
      const middleDraftBulk: Alarm = AlarmRepositoryContract.createdAtMinute(BULK_DRAFT, 3);
      const dispatchingBulk: Alarm = AlarmRepositoryContract.dispatched(
        AlarmRepositoryContract.createdAtMinute(BULK_DRAFT, 4),
      );
      const newestDraftBulk: Alarm = AlarmRepositoryContract.createdAtMinute(BULK_DRAFT, 5);
      await Promise.all(
        [oldestDraftBulk, draftUrgent, middleDraftBulk, dispatchingBulk, newestDraftBulk].map(
          (alarm: Alarm): Promise<void> => repository.save(alarm),
        ),
      );
      const filtered: Pick<AlarmPageQuery, 'status' | 'alarmKind' | 'size'> = {
        status: { kind: 'exactly', value: 'DRAFT' },
        alarmKind: { kind: 'exactly', value: 'BULK' },
        size: AlarmRepositoryContract.pageSize(2),
      };

      const firstPage: AlarmPage = await repository.findPage({
        ...filtered,
        start: { kind: 'newest' },
      });
      const secondPage: AlarmPage = await repository.findPage({
        ...filtered,
        start: AlarmRepositoryContract.startAfter(firstPage),
      });

      expect(AlarmRepositoryContract.summarize(firstPage)).toEqual({
        ids: [newestDraftBulk.snapshot().id, middleDraftBulk.snapshot().id],
        next: {
          kind: 'more',
          after: {
            createdAt: middleDraftBulk.snapshot().createdAt,
            id: middleDraftBulk.snapshot().id,
          },
        },
      });
      expect(AlarmRepositoryContract.summarize(secondPage)).toEqual({
        ids: [oldestDraftBulk.snapshot().id],
        next: { kind: 'last' },
      });
      expect(firstPage.alarms.map((alarm: Alarm): AlarmSnapshot => alarm.snapshot())).toEqual([
        newestDraftBulk.snapshot(),
        middleDraftBulk.snapshot(),
      ]);
    });

    it('DB-02 필터가 없으면 모든 상태와 종류의 알림을 생성 역순으로 돌려준다', async (): Promise<void> => {
      const repository: ContractAlarmRepository = await createRepository();
      const urgent: Alarm = AlarmRepositoryContract.createdAtMinute(URGENT_DRAFT, 1);
      const cancelledBulk: Alarm = AlarmRepositoryContract.transitioned(
        AlarmRepositoryContract.createdAtMinute(BULK_DRAFT, 2).cancel(new Date(CANCELLED_ISO)),
      );
      await repository.save(urgent);
      await repository.save(cancelledBulk);

      const page: AlarmPage = await repository.findPage({
        status: { kind: 'any' },
        alarmKind: { kind: 'any' },
        start: { kind: 'newest' },
        size: AlarmRepositoryContract.pageSize(2),
      });

      expect(AlarmRepositoryContract.summarize(page)).toEqual({
        ids: [cancelledBulk.snapshot().id, urgent.snapshot().id],
        next: { kind: 'last' },
      });
    });

    it('DB-02 저장된 알림이 없으면 빈 마지막 페이지를 돌려준다', async (): Promise<void> => {
      const repository: ContractAlarmRepository = await createRepository();

      const page: AlarmPage = await repository.findPage({
        status: { kind: 'any' },
        alarmKind: { kind: 'any' },
        start: { kind: 'newest' },
        size: AlarmRepositoryContract.pageSize(1),
      });

      expect(AlarmRepositoryContract.summarize(page)).toEqual({ ids: [], next: { kind: 'last' } });
    });

    it('DB-02 필터에 맞는 알림이 없으면 빈 마지막 페이지를 돌려준다', async (): Promise<void> => {
      const repository: ContractAlarmRepository = await createRepository();
      await repository.save(AlarmRepositoryContract.createdAtMinute(BULK_DRAFT, 1));

      const page: AlarmPage = await repository.findPage({
        status: { kind: 'exactly', value: 'COMPLETED' },
        alarmKind: { kind: 'exactly', value: 'URGENT' },
        start: { kind: 'newest' },
        size: AlarmRepositoryContract.pageSize(1),
      });

      expect(AlarmRepositoryContract.summarize(page)).toEqual({ ids: [], next: { kind: 'last' } });
    });

    it('DB-02 남은 알림 수가 페이지 크기와 같으면 다음 cursor 없이 마지막 페이지가 된다', async (): Promise<void> => {
      const repository: ContractAlarmRepository = await createRepository();
      const older: Alarm = AlarmRepositoryContract.createdAtMinute(BULK_DRAFT, 1);
      const newer: Alarm = AlarmRepositoryContract.createdAtMinute(BULK_DRAFT, 2);
      await repository.save(older);
      await repository.save(newer);

      const page: AlarmPage = await repository.findPage({
        status: { kind: 'any' },
        alarmKind: { kind: 'any' },
        start: { kind: 'newest' },
        size: AlarmRepositoryContract.pageSize(2),
      });

      expect(AlarmRepositoryContract.summarize(page)).toEqual({
        ids: [newer.snapshot().id, older.snapshot().id],
        next: { kind: 'last' },
      });
    });

    it('DB-02 페이지 크기가 1이면 한 건씩 나뉘고 가장 오래된 알림 뒤에서는 빈 마지막 페이지가 나온다', async (): Promise<void> => {
      const repository: ContractAlarmRepository = await createRepository();
      const older: Alarm = AlarmRepositoryContract.createdAtMinute(BULK_DRAFT, 1);
      const newer: Alarm = AlarmRepositoryContract.createdAtMinute(BULK_DRAFT, 2);
      await repository.save(older);
      await repository.save(newer);
      const unfiltered: Pick<AlarmPageQuery, 'status' | 'alarmKind' | 'size'> = {
        status: { kind: 'any' },
        alarmKind: { kind: 'any' },
        size: AlarmRepositoryContract.pageSize(1),
      };

      const firstPage: AlarmPage = await repository.findPage({
        ...unfiltered,
        start: { kind: 'newest' },
      });
      const afterOldest: AlarmPage = await repository.findPage({
        ...unfiltered,
        start: {
          kind: 'after',
          position: { createdAt: older.snapshot().createdAt, id: older.snapshot().id },
        },
      });

      expect(AlarmRepositoryContract.summarize(firstPage)).toEqual({
        ids: [newer.snapshot().id],
        next: {
          kind: 'more',
          after: { createdAt: newer.snapshot().createdAt, id: newer.snapshot().id },
        },
      });
      expect(AlarmRepositoryContract.summarize(afterOldest)).toEqual({
        ids: [],
        next: { kind: 'last' },
      });
    });

    it('DB-03 생성 시각이 같은 알림 여러 개 / cursor로 끝까지 조회한다 → (생성 시각, id) 복합 cursor로 누락·중복 없이 이어진다', async (): Promise<void> => {
      const repository: ContractAlarmRepository = await createRepository();
      const older: Alarm = AlarmRepositoryContract.createdAtMinute(BULK_DRAFT, 1);
      const sameInstant: ReadonlyArray<Alarm> = Array.from({ length: 5 }, (): Alarm =>
        AlarmRepositoryContract.createdAtMinute(BULK_DRAFT, 2),
      );
      await Promise.all(
        [older, ...sameInstant].map((alarm: Alarm): Promise<void> => repository.save(alarm)),
      );

      const visited: ReadonlyArray<string> = await AlarmRepositoryContract.readAll(repository, {
        kind: 'newest',
      });

      expect(visited).toEqual([
        ...sameInstant
          .map((alarm: Alarm): string => alarm.snapshot().id)
          .toSorted()
          .toReversed(),
        older.snapshot().id,
      ]);
    });
  }

  private static async readAll(
    repository: ContractAlarmRepository,
    start: AlarmPageStart,
  ): Promise<ReadonlyArray<string>> {
    const page: AlarmPage = await repository.findPage({
      status: { kind: 'any' },
      alarmKind: { kind: 'any' },
      start,
      size: AlarmRepositoryContract.pageSize(2),
    });
    const pageAlarmIds: ReadonlyArray<string> = page.alarms.map(
      (alarm: Alarm): string => alarm.snapshot().id,
    );
    if (page.next.kind === 'last') {
      return pageAlarmIds;
    }
    return [
      ...pageAlarmIds,
      ...(await AlarmRepositoryContract.readAll(
        repository,
        AlarmRepositoryContract.startAfter(page),
      )),
    ];
  }

  private static startAfter({ next }: Readonly<AlarmPage>): AlarmPageStart {
    KindAssertion.assertKind(next, 'more');
    const { after }: KindMember<AlarmPageNext, 'more'> = next;
    return { kind: 'after', position: after };
  }

  private static summarize({ alarms, next }: Readonly<AlarmPage>): PageSummary {
    return {
      ids: alarms.map((alarm: Alarm): string => alarm.snapshot().id),
      next,
    };
  }

  private static pageSize(value: number): PageSize {
    if (!AlarmRepositoryPredicates.isPageSize(value)) {
      throw new Error(`contract fixture page size ${value} is invalid`);
    }
    return value;
  }

  private static createdAtMinute(draft: Readonly<AlarmDraft>, minute: number): Alarm {
    const creation: AlarmCreation = Alarm.create(
      AlarmRepositoryContract.newAlarmId(),
      draft,
      new Date(Date.UTC(2026, 9, 8, 8, minute, 0, 123)),
    );
    KindAssertion.assertKind(creation, 'created');
    const { alarm }: KindMember<AlarmCreation, 'created'> = creation;
    return alarm;
  }

  private static newAlarmId(): AlarmId {
    const rawAlarmId: string = randomUUID();
    if (!AlarmPredicates.isAlarmId(rawAlarmId)) {
      throw new Error(`generated ${rawAlarmId} is not a valid AlarmId`);
    }
    return rawAlarmId;
  }

  private static created(draft: Readonly<AlarmDraft>): Alarm {
    const creation: AlarmCreation = Alarm.create(
      AlarmRepositoryContract.newAlarmId(),
      draft,
      new Date(CREATED_ISO),
    );
    KindAssertion.assertKind(creation, 'created');
    const { alarm }: KindMember<AlarmCreation, 'created'> = creation;
    return alarm;
  }

  private static dispatched(alarm: Alarm): Alarm {
    return AlarmRepositoryContract.transitioned(alarm.startDispatch(new Date(DISPATCHED_ISO)));
  }

  private static completed(alarm: Alarm): Alarm {
    const deliveryCount: number = 0;
    if (!AlarmPredicates.isDeliveryCount(deliveryCount)) {
      throw new Error('contract fixture delivery count is invalid');
    }
    const completion: AlarmCompletion = alarm.complete(
      { expansionCompleted: true, unsettledDeliveries: deliveryCount },
      new Date(COMPLETED_ISO),
    );
    KindAssertion.assertKind(completion, 'transitioned');
    const { alarm: completedAlarm }: KindMember<AlarmCompletion, 'transitioned'> = completion;
    return completedAlarm;
  }

  private static transitioned(transition: AlarmTransition): Alarm {
    KindAssertion.assertKind(transition, 'transitioned');
    const { alarm }: KindMember<AlarmTransition, 'transitioned'> = transition;
    return alarm;
  }

  private static found(lookup: AlarmLookup): Alarm {
    KindAssertion.assertKind(lookup, 'found');
    const { alarm }: KindMember<AlarmLookup, 'found'> = lookup;
    return alarm;
  }
}
