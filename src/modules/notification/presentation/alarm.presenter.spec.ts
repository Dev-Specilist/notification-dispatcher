import { describe, expect, it } from 'vitest';
import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import {
  AlarmCompletion,
  AlarmCreation,
  AlarmDraft,
  AlarmTransition,
  AlarmValidationError,
  DeliveryCount,
} from '@/modules/notification/domain/alarm/alarm.type';
import { AlarmResponse } from '@/modules/notification/presentation/alarm-response.type';
import { AlarmPresenter } from '@/modules/notification/presentation/alarm.presenter';
import { FieldViolation } from '@/shared/http/problem-details.type';

type StateCase = Readonly<[string, () => Alarm, AlarmResponse]>;

type ViolationCase = Readonly<[AlarmValidationError, FieldViolation]>;

const ALARM_ID: string = '0b6c1b4e-9a37-4c2a-8d6a-2f6b2d7f1a10';
const CREATED_ISO: string = '2026-10-08T09:00:00.000Z';
const DISPATCHED_ISO: string = '2026-10-08T09:05:00.000Z';
const SETTLED_ISO: string = '2026-10-08T09:10:00.000Z';

const URGENT_DRAFT: AlarmDraft = {
  title: '서버 점검',
  body: '10분 뒤 점검이 시작됩니다',
  kind: 'URGENT',
  recipientIds: ['u_000001', 'u_000002'],
};

const BULK_DRAFT: AlarmDraft = {
  title: '추석 이벤트',
  body: '연휴 쿠폰이 도착했어요',
  kind: 'BULK',
  recipientIds: [],
};

const created = (draft: Readonly<AlarmDraft>): Alarm => {
  if (!AlarmPredicates.isAlarmId(ALARM_ID)) {
    throw new Error('test fixture id is invalid');
  }
  const creation: AlarmCreation = Alarm.create(ALARM_ID, draft, new Date(CREATED_ISO));
  if (creation.kind !== 'created') {
    throw new Error(`test fixture alarm is invalid: ${creation.error.code}`);
  }
  return creation.alarm;
};

const transitioned = (transition: AlarmTransition | AlarmCompletion): Alarm => {
  if (transition.kind !== 'transitioned') {
    throw new Error(`test fixture transition failed: ${transition.kind}`);
  }
  return transition.alarm;
};

const noUnsettled = (): DeliveryCount => {
  const count: number = 0;
  if (!AlarmPredicates.isDeliveryCount(count)) {
    throw new Error('test fixture count is invalid');
  }
  return count;
};

const dispatched = (draft: Readonly<AlarmDraft>): Alarm =>
  transitioned(created(draft).startDispatch(new Date(DISPATCHED_ISO)));

const URGENT_BASE: Omit<AlarmResponse, 'status'> = {
  id: ALARM_ID,
  title: '서버 점검',
  body: '10분 뒤 점검이 시작됩니다',
  kind: 'URGENT',
  recipientIds: ['u_000001', 'u_000002'],
  createdAt: CREATED_ISO,
};

describe('AlarmPresenter', () => {
  it.each<StateCase>([
    ['DRAFT', (): Alarm => created(URGENT_DRAFT), { ...URGENT_BASE, status: 'DRAFT' }],
    [
      'DISPATCHING',
      (): Alarm => dispatched(URGENT_DRAFT),
      { ...URGENT_BASE, status: 'DISPATCHING', dispatchedAt: DISPATCHED_ISO },
    ],
    [
      'COMPLETED',
      (): Alarm =>
        transitioned(
          dispatched(URGENT_DRAFT).complete(
            { expansionCompleted: true, unsettledDeliveries: noUnsettled() },
            new Date(SETTLED_ISO),
          ),
        ),
      {
        ...URGENT_BASE,
        status: 'COMPLETED',
        dispatchedAt: DISPATCHED_ISO,
        completedAt: SETTLED_ISO,
      },
    ],
    [
      '발송 전 CANCELLED',
      (): Alarm => transitioned(created(URGENT_DRAFT).cancel(new Date(SETTLED_ISO))),
      { ...URGENT_BASE, status: 'CANCELLED', cancelledAt: SETTLED_ISO },
    ],
    [
      '발송 후 CANCELLED',
      (): Alarm => transitioned(dispatched(URGENT_DRAFT).cancel(new Date(SETTLED_ISO))),
      {
        ...URGENT_BASE,
        status: 'CANCELLED',
        dispatchedAt: DISPATCHED_ISO,
        cancelledAt: SETTLED_ISO,
      },
    ],
  ])(
    '%s 알림을 상태에 맞는 시각만 담은 응답으로 바꾸고 시각은 UTC ISO 8601로 표기한다',
    (_label: string, alarmOf: () => Alarm, expected: AlarmResponse): void => {
      expect(AlarmPresenter.toResponse(alarmOf())).toEqual(expected);
    },
  );

  it('전체 사용자 대상인 대량 알림은 수신자 목록을 비워서 응답한다', (): void => {
    expect(AlarmPresenter.toResponse(created(BULK_DRAFT))).toMatchObject({
      kind: 'BULK',
      recipientIds: [],
    });
  });

  it.each<ViolationCase>([
    [{ code: 'EMPTY_TITLE' }, { field: 'title', message: '제목이 비어 있습니다' }],
    [{ code: 'EMPTY_BODY' }, { field: 'body', message: '본문이 비어 있습니다' }],
    [
      { code: 'BULK_RECIPIENTS_NOT_ALLOWED' },
      { field: 'recipientIds', message: '대량 알림은 수신자를 지정할 수 없습니다' },
    ],
    [
      { code: 'URGENT_RECIPIENTS_OUT_OF_RANGE', count: 0, min: 1, max: 100 },
      { field: 'recipientIds', message: '긴급 알림 수신자는 1~100명이어야 합니다 (현재 0명)' },
    ],
    [
      { code: 'INVALID_RECIPIENT_ID', value: 'bad id' },
      { field: 'recipientIds', message: '수신자 id 형식이 잘못되었습니다: bad id' },
    ],
  ])(
    '도메인 거절 사유 %o를 요청 필드 오류로 바꾼다',
    (error: AlarmValidationError, expected: FieldViolation): void => {
      expect(AlarmPresenter.violationOf(error)).toEqual(expected);
    },
  );
});
