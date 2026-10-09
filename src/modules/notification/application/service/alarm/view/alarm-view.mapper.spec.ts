import { describe, expect, it } from 'vitest';
import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import {
  AlarmCompletion,
  AlarmCreated,
  AlarmCreation,
  AlarmDraft,
  AlarmTransition,
  AlarmTransitioned,
  DeliveryCount,
} from '@/modules/notification/domain/alarm/alarm.type';
import { AlarmView } from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-view.type';
import { AlarmViewMapper } from '@/modules/notification/application/service/alarm/view/alarm-view.mapper';
import { KindAssertion } from '@/shared/testing/kind.assertion';

const ALARM_ID: string = '0b6c1b4e-9a37-4c2a-8d6a-2f6b2d7f1a10';
const CREATED_ISO: string = '2026-10-08T09:00:00.000Z';
const DISPATCHED_ISO: string = '2026-10-08T09:05:00.000Z';

const created = (draft: Readonly<AlarmDraft>): Alarm => {
  if (!AlarmPredicates.isAlarmId(ALARM_ID)) {
    throw new Error('test fixture id is invalid');
  }
  const creation: AlarmCreation = Alarm.create(ALARM_ID, draft, new Date(CREATED_ISO));
  KindAssertion.assertKind(creation, 'created');
  const { alarm }: AlarmCreated = creation;
  return alarm;
};

const transitioned = (transition: AlarmTransition): Alarm => {
  KindAssertion.assertKind(transition, 'transitioned');
  const { alarm }: AlarmTransitioned = transition;
  return alarm;
};

const completed = (completion: AlarmCompletion): Alarm => {
  KindAssertion.assertKind(completion, 'transitioned');
  const { alarm }: AlarmTransitioned = completion;
  return alarm;
};

const noUnsettled = (): DeliveryCount => {
  const count: number = 0;
  if (!AlarmPredicates.isDeliveryCount(count)) {
    throw new Error('test fixture count is invalid');
  }
  return count;
};

describe('AlarmViewMapper', () => {
  it('긴급 알림을 지정 수신자와 상태를 담은 결과 DTO로 바꾼다', (): void => {
    const alarm: Alarm = transitioned(
      created({
        title: '서버 점검',
        body: '10분 뒤 점검이 시작됩니다',
        kind: 'URGENT',
        recipientIds: ['u_000001', 'u_000002'],
      }).startDispatch(new Date(DISPATCHED_ISO)),
    );

    const view: AlarmView = AlarmViewMapper.toView(alarm);

    expect(view).toEqual({
      id: ALARM_ID,
      title: '서버 점검',
      body: '10분 뒤 점검이 시작됩니다',
      kind: 'URGENT',
      recipientIds: ['u_000001', 'u_000002'],
      state: { status: 'DISPATCHING', dispatchedAt: new Date(DISPATCHED_ISO) },
      createdAt: new Date(CREATED_ISO),
    });
  });

  it('완료된 알림은 발송 시각과 완료 시각을 함께 담아 바꾼다', (): void => {
    const completedAt: Date = new Date('2026-10-08T09:20:00.000Z');
    const dispatched: Alarm = transitioned(
      created({
        title: '추석 이벤트',
        body: '쿠폰 도착',
        kind: 'BULK',
        recipientIds: [],
      }).startDispatch(new Date(DISPATCHED_ISO)),
    );

    const view: AlarmView = AlarmViewMapper.toView(
      completed(
        dispatched.complete(
          { expansionCompleted: true, unsettledDeliveries: noUnsettled() },
          completedAt,
        ),
      ),
    );

    expect(view.state).toEqual({
      status: 'COMPLETED',
      dispatchedAt: new Date('2026-10-08T09:05:00.000Z'),
      completedAt: new Date('2026-10-08T09:20:00.000Z'),
    });
  });

  it('발송 전에 취소된 알림은 발송 시각 없이, 발송 후 취소된 알림은 발송 시각과 함께 바꾼다', (): void => {
    const draft: Alarm = created({
      title: '추석 이벤트',
      body: '쿠폰 도착',
      kind: 'BULK',
      recipientIds: [],
    });
    const cancelledAt: Date = new Date('2026-10-08T09:10:00.000Z');

    const beforeDispatch: AlarmView = AlarmViewMapper.toView(
      transitioned(draft.cancel(cancelledAt)),
    );
    const afterDispatch: AlarmView = AlarmViewMapper.toView(
      transitioned(transitioned(draft.startDispatch(new Date(DISPATCHED_ISO))).cancel(cancelledAt)),
    );

    expect(beforeDispatch.state).toEqual({ status: 'CANCELLED', cancelledAt });
    expect(afterDispatch.state).toEqual({
      status: 'CANCELLED',
      cancelledAt,
      dispatchedAt: new Date(DISPATCHED_ISO),
    });
  });

  it('전체 사용자 대상인 대량 알림은 수신자 목록을 비워서 바꾼다', (): void => {
    const view: AlarmView = AlarmViewMapper.toView(
      created({ title: '추석 이벤트', body: '쿠폰 도착', kind: 'BULK', recipientIds: [] }),
    );

    expect(view).toMatchObject({ kind: 'BULK', recipientIds: [] });
  });

  it('결과 DTO의 시각을 바꿔도 엔티티의 시각은 바뀌지 않는다', (): void => {
    const alarm: Alarm = created({
      title: '추석 이벤트',
      body: '쿠폰 도착',
      kind: 'BULK',
      recipientIds: [],
    });

    AlarmViewMapper.toView(alarm).createdAt.setUTCFullYear(1990);

    expect(alarm.snapshot().createdAt).toEqual(new Date(CREATED_ISO));
  });
});
