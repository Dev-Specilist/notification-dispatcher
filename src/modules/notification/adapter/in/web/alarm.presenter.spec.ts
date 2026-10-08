import { describe, expect, it } from 'vitest';
import {
  AlarmView,
  AlarmViewState,
} from '@/modules/notification/application/port/in/alarm-view.type';
import { AlarmNotFoundError } from '@/modules/notification/application/port/in/alarm-result.type';
import { AlarmCreationError } from '@/modules/notification/application/port/in/create-alarm.type';
import { DeliveryProgressView } from '@/modules/notification/application/port/in/delivery-progress-view.type';
import {
  AlarmDetailResponse,
  AlarmResponse,
} from '@/modules/notification/adapter/in/web/alarm-response.type';
import { AlarmPresenter } from '@/modules/notification/adapter/in/web/alarm.presenter';
import { FieldViolation } from '@/shared/http/problem-details.type';
import { ProblemException } from '@/shared/http/problem.exception';

type StateCase = Readonly<[string, AlarmViewState, AlarmResponse]>;

type ViolationCase = Readonly<[AlarmCreationError, FieldViolation]>;

const CREATED_ISO: string = '2026-10-08T09:00:00.000Z';
const DISPATCHED_ISO: string = '2026-10-08T09:05:00.000Z';
const SETTLED_ISO: string = '2026-10-08T09:10:00.000Z';

const urgentView = (state: AlarmViewState): AlarmView => ({
  id: '0b6c1b4e-9a37-4c2a-8d6a-2f6b2d7f1a10',
  title: '서버 점검',
  body: '10분 뒤 점검이 시작됩니다',
  kind: 'URGENT',
  recipientIds: ['u_000001', 'u_000002'],
  state,
  createdAt: new Date(CREATED_ISO),
});

const URGENT_BASE: Omit<AlarmResponse, 'status'> = {
  id: '0b6c1b4e-9a37-4c2a-8d6a-2f6b2d7f1a10',
  title: '서버 점검',
  body: '10분 뒤 점검이 시작됩니다',
  kind: 'URGENT',
  recipientIds: ['u_000001', 'u_000002'],
  createdAt: CREATED_ISO,
};

describe('AlarmPresenter', () => {
  it.each<StateCase>([
    ['DRAFT', { status: 'DRAFT' }, { ...URGENT_BASE, status: 'DRAFT' }],
    [
      'DISPATCHING',
      { status: 'DISPATCHING', dispatchedAt: new Date(DISPATCHED_ISO) },
      { ...URGENT_BASE, status: 'DISPATCHING', dispatchedAt: DISPATCHED_ISO },
    ],
    [
      'COMPLETED',
      {
        status: 'COMPLETED',
        dispatchedAt: new Date(DISPATCHED_ISO),
        completedAt: new Date(SETTLED_ISO),
      },
      {
        ...URGENT_BASE,
        status: 'COMPLETED',
        dispatchedAt: DISPATCHED_ISO,
        completedAt: SETTLED_ISO,
      },
    ],
    [
      '발송 전 CANCELLED',
      { status: 'CANCELLED', cancelledAt: new Date(SETTLED_ISO) },
      { ...URGENT_BASE, status: 'CANCELLED', cancelledAt: SETTLED_ISO },
    ],
    [
      '발송 후 CANCELLED',
      {
        status: 'CANCELLED',
        cancelledAt: new Date(SETTLED_ISO),
        dispatchedAt: new Date(DISPATCHED_ISO),
      },
      {
        ...URGENT_BASE,
        status: 'CANCELLED',
        dispatchedAt: DISPATCHED_ISO,
        cancelledAt: SETTLED_ISO,
      },
    ],
  ])(
    '%s 결과 DTO를 상태에 맞는 시각만 담은 응답으로 바꾸고 시각은 UTC ISO 8601로 표기한다',
    (_label: string, state: AlarmViewState, expected: AlarmResponse): void => {
      expect(AlarmPresenter.toResponse(urgentView(state))).toEqual(expected);
    },
  );

  it('조회 결과는 알림 응답에 상태별 Delivery 수를 담은 deliveries를 더해 응답한다', (): void => {
    const deliveries: DeliveryProgressView = {
      total: 3,
      byStatus: {
        PENDING: 1,
        IN_FLIGHT: 0,
        RETRY_WAIT: 0,
        UNKNOWN: 0,
        SENT: 2,
        FAILED: 0,
        UNCONFIRMED: 0,
        CANCELLED: 0,
      },
    };

    const response: AlarmDetailResponse = AlarmPresenter.toDetailResponse(
      urgentView({ status: 'DISPATCHING', dispatchedAt: new Date(DISPATCHED_ISO) }),
      deliveries,
    );

    expect(response).toEqual({
      ...URGENT_BASE,
      status: 'DISPATCHING',
      dispatchedAt: DISPATCHED_ISO,
      deliveries: {
        total: 3,
        byStatus: {
          PENDING: 1,
          IN_FLIGHT: 0,
          RETRY_WAIT: 0,
          UNKNOWN: 0,
          SENT: 2,
          FAILED: 0,
          UNCONFIRMED: 0,
          CANCELLED: 0,
        },
      },
    });
  });

  it('결과 DTO의 수신자 목록을 새 배열로 옮겨 응답한다', (): void => {
    const view: AlarmView = urgentView({ status: 'DRAFT' });

    const response: AlarmResponse = AlarmPresenter.toResponse(view);

    expect(response.recipientIds).toEqual(view.recipientIds);
    expect(response.recipientIds).not.toBe(view.recipientIds);
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
    (error: AlarmCreationError, expected: FieldViolation): void => {
      expect(AlarmPresenter.violationOf(error)).toEqual(expected);
    },
  );

  it('알림 없음 오류를 404 ALARM_NOT_FOUND 문제로 바꾸고 찾은 id를 설명에 담는다', (): void => {
    const error: AlarmNotFoundError = {
      code: 'ALARM_NOT_FOUND',
      alarmId: '7d3f1e2a-4b5c-4d6e-8f70-1a2b3c4d5e6f',
    };

    const problem: ProblemException = AlarmPresenter.problemOf(error);

    expect(problem.getStatus()).toBe(404);
    expect(problem.code).toBe('ALARM_NOT_FOUND');
    expect(problem.message).toBe('알림을 찾을 수 없습니다: 7d3f1e2a-4b5c-4d6e-8f70-1a2b3c4d5e6f');
  });
});
