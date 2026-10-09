import { describe, expect, it } from 'vitest';
import {
  AlarmView,
  AlarmViewState,
} from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-view.type';
import {
  AlarmNotFoundError,
  AlarmStateConflictError,
} from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-result.type';
import { AlarmCreationError } from '@/modules/notification/application/port/driving/for-managing-alarms/create-alarm.type';
import { DeliveryProgressView } from '@/modules/notification/application/port/driving/for-managing-alarms/delivery-progress-view.type';
import { ListAlarmsError } from '@/modules/notification/application/port/driving/for-managing-alarms/list-alarms.type';
import {
  AlarmDetailResponse,
  AlarmListResponse,
  AlarmResponse,
} from '@/modules/notification/adapter/driving/web/alarm-response.type';
import { AlarmPresenter } from '@/modules/notification/adapter/driving/web/alarm.presenter';
import { FieldViolation } from '@/shared/http/problem-details.type';
import { ProblemException } from '@/shared/http/problem.exception';

type StateCase = Readonly<[string, AlarmViewState, AlarmResponse]>;

type ViolationCase = Readonly<[AlarmCreationError, FieldViolation]>;

type ListViolationCase = Readonly<[error: ListAlarmsError, expected: FieldViolation]>;

type ConflictCase = Readonly<[action: AlarmStateConflictError['action'], detail: string]>;

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

  it.each<ConflictCase>([
    ['dispatch', 'DISPATCHING 상태의 알림은 발송을 시작할 수 없습니다'],
    ['cancel', 'DISPATCHING 상태의 알림은 취소할 수 없습니다'],
    ['complete', 'DISPATCHING 상태의 알림은 완료할 수 없습니다'],
  ])(
    '%s 상태 충돌을 409 ALARM_STATE_CONFLICT 문제로 바꾸고 현재 상태와 막힌 동작을 설명에 담는다',
    (action: AlarmStateConflictError['action'], detail: string): void => {
      const error: AlarmStateConflictError = {
        code: 'ALARM_STATE_CONFLICT',
        status: 'DISPATCHING',
        action,
      };

      const problem: ProblemException = AlarmPresenter.problemOf(error);

      expect(problem.getStatus()).toBe(409);
      expect(problem.code).toBe('ALARM_STATE_CONFLICT');
      expect(problem.message).toBe(detail);
    },
  );

  it('다음 페이지가 있으면 결과 DTO 목록을 응답으로 바꾸고 다음 시작 위치를 생성 시각과 id를 담은 cursor로 준다', (): void => {
    const view: AlarmView = urgentView({ status: 'DRAFT' });

    const response: AlarmListResponse = AlarmPresenter.toListResponse({
      kind: 'page',
      items: [view],
      next: {
        kind: 'more',
        after: {
          createdAt: new Date(CREATED_ISO),
          alarmId: '0b6c1b4e-9a37-4c2a-8d6a-2f6b2d7f1a10',
        },
      },
    });

    expect(response).toEqual({
      alarms: [AlarmPresenter.toResponse(view)],
      page: {
        nextCursor: Buffer.from(
          `${CREATED_ISO}|0b6c1b4e-9a37-4c2a-8d6a-2f6b2d7f1a10`,
          'utf8',
        ).toString('base64url'),
      },
    });
  });

  it('마지막 페이지면 page에 nextCursor 필드를 두지 않는다', (): void => {
    const response: AlarmListResponse = AlarmPresenter.toListResponse({
      kind: 'page',
      items: [],
      next: { kind: 'last' },
    });

    expect(response).toEqual({ alarms: [], page: {} });
  });

  it.each<ListViolationCase>([
    [{ code: 'INVALID_CURSOR' }, { field: 'cursor', message: 'cursor가 올바르지 않습니다' }],
    [
      { code: 'INVALID_LIMIT', limit: 0 },
      { field: 'limit', message: 'limit은 1 이상의 정수여야 합니다 (현재 0)' },
    ],
  ])(
    '목록 조회 거절 사유 %o를 요청 필드 오류로 바꾼다',
    (error: ListAlarmsError, expected: FieldViolation): void => {
      expect(AlarmPresenter.listViolationOf(error)).toEqual(expected);
    },
  );
});
