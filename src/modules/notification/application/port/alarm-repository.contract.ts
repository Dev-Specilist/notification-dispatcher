import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import {
  AlarmCompletion,
  AlarmCreation,
  AlarmDraft,
  AlarmId,
  AlarmTransition,
} from '@/modules/notification/domain/alarm/alarm.type';
import { AlarmRepositoryPort } from '@/modules/notification/application/port/alarm-repository.port';
import { AlarmLookup } from '@/modules/notification/application/port/alarm-repository.type';

type AlarmRepositoryFactory = () => Promise<AlarmRepositoryPort>;

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
      const repository: AlarmRepositoryPort = await createRepository();
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
        const repository: AlarmRepositoryPort = await createRepository();
        const alarm: Alarm = advance(AlarmRepositoryContract.created(URGENT_DRAFT));

        await repository.save(alarm);

        expect(
          AlarmRepositoryContract.found(await repository.findById(alarm.snapshot().id)).snapshot(),
        ).toEqual(alarm.snapshot());
      },
    );

    it('DB-01 저장하지 않은 id로 조회하면 없음으로 돌려준다', async (): Promise<void> => {
      const repository: AlarmRepositoryPort = await createRepository();

      expect(await repository.findById(AlarmRepositoryContract.newAlarmId())).toEqual({
        kind: 'missing',
      });
    });

    it('DB-01 상태가 바뀐 알림을 다시 저장하면 마지막 상태로 조회된다', async (): Promise<void> => {
      const repository: AlarmRepositoryPort = await createRepository();
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
      const repository: AlarmRepositoryPort = await createRepository();
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
      const repository: AlarmRepositoryPort = await createRepository();

      expect(await repository.findByIdForUpdate(AlarmRepositoryContract.newAlarmId())).toEqual({
        kind: 'missing',
      });
    });

    it('DB-01 조회한 알림의 Date를 바꿔도 저장된 값은 바뀌지 않는다', async (): Promise<void> => {
      const repository: AlarmRepositoryPort = await createRepository();
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
  }

  private static newAlarmId(): AlarmId {
    const value: string = randomUUID();
    if (!AlarmPredicates.isAlarmId(value)) {
      throw new Error(`generated ${value} is not a valid AlarmId`);
    }
    return value;
  }

  private static created(draft: Readonly<AlarmDraft>): Alarm {
    const creation: AlarmCreation = Alarm.create(
      AlarmRepositoryContract.newAlarmId(),
      draft,
      new Date(CREATED_ISO),
    );
    if (creation.kind !== 'created') {
      throw new Error(`contract fixture alarm is invalid: ${creation.error.code}`);
    }
    return creation.alarm;
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
    if (completion.kind !== 'transitioned') {
      throw new Error(`contract fixture completion failed: ${completion.kind}`);
    }
    return completion.alarm;
  }

  private static transitioned(transition: AlarmTransition): Alarm {
    if (transition.kind !== 'transitioned') {
      throw new Error(`contract fixture transition failed: ${transition.error.code}`);
    }
    return transition.alarm;
  }

  private static found(lookup: AlarmLookup): Alarm {
    if (lookup.kind !== 'found') {
      throw new Error('expected the alarm to be stored');
    }
    return lookup.alarm;
  }
}
