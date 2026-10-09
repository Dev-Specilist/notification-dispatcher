import {
  AlarmView,
  AlarmViewState,
} from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-view.type';
import {
  AlarmActionName,
  AlarmNotFoundError,
  AlarmStateConflictError,
} from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-result.type';
import { AlarmCreationError } from '@/modules/notification/application/port/driving/for-managing-alarms/create-alarm.type';
import { DeliveryProgressView } from '@/modules/notification/application/port/driving/for-managing-alarms/delivery-progress-view.type';
import {
  AlarmListPage,
  ListAlarmsError,
} from '@/modules/notification/application/port/driving/for-managing-alarms/list-alarms.type';
import { AlarmCursor } from '@/modules/notification/adapter/driving/web/alarm-cursor.util';
import {
  AlarmDetailResponse,
  AlarmListResponse,
  AlarmResponse,
  AlarmResponseBase,
} from '@/modules/notification/adapter/driving/web/alarm-response.type';
import { HttpStatus } from '@nestjs/common';
import { FieldViolation } from '@/shared/http/problem-details.type';
import { ProblemException } from '@/shared/http/problem.exception';

export class AlarmPresenter {
  private static readonly BLOCKED_ACTION_PHRASES: Readonly<Record<AlarmActionName, string>> = {
    dispatch: '발송을 시작할 수 없습니다',
    cancel: '취소할 수 없습니다',
    complete: '완료할 수 없습니다',
  };

  static toResponse(view: Readonly<AlarmView>): AlarmResponse {
    const { id, title, body, kind, recipientIds, state, createdAt }: Readonly<AlarmView> = view;
    const base: AlarmResponseBase = {
      id,
      title,
      body,
      kind,
      recipientIds: [...recipientIds],
      createdAt: createdAt.toISOString(),
    };
    return AlarmPresenter.withState(base, state);
  }

  static toDetailResponse(
    view: Readonly<AlarmView>,
    { total, byStatus }: Readonly<DeliveryProgressView>,
  ): AlarmDetailResponse {
    return {
      ...AlarmPresenter.toResponse(view),
      deliveries: { total, byStatus: { ...byStatus } },
    };
  }

  static toListResponse({ items, next }: Readonly<AlarmListPage>): AlarmListResponse {
    return {
      alarms: items.map((view: AlarmView): AlarmResponse => AlarmPresenter.toResponse(view)),
      page: next.kind === 'more' ? { nextCursor: AlarmCursor.encode(next.after) } : {},
    };
  }

  static listViolationOf(error: ListAlarmsError): FieldViolation {
    if (error.code === 'INVALID_CURSOR') {
      return { field: 'cursor', message: 'cursor가 올바르지 않습니다' };
    }
    return {
      field: 'limit',
      message: `limit은 1 이상의 정수여야 합니다 (현재 ${error.limit})`,
    };
  }

  static violationOf(error: AlarmCreationError): FieldViolation {
    switch (error.code) {
      case 'EMPTY_TITLE':
        return { field: 'title', message: '제목이 비어 있습니다' };
      case 'EMPTY_BODY':
        return { field: 'body', message: '본문이 비어 있습니다' };
      case 'BULK_RECIPIENTS_NOT_ALLOWED':
        return { field: 'recipientIds', message: '대량 알림은 수신자를 지정할 수 없습니다' };
      case 'URGENT_RECIPIENTS_OUT_OF_RANGE':
        return {
          field: 'recipientIds',
          message: `긴급 알림 수신자는 ${error.min}~${error.max}명이어야 합니다 (현재 ${error.count}명)`,
        };
      case 'INVALID_RECIPIENT_ID':
        break;
    }
    return { field: 'recipientIds', message: `수신자 id 형식이 잘못되었습니다: ${error.value}` };
  }

  static problemOf(error: AlarmNotFoundError | AlarmStateConflictError): ProblemException {
    if (error.code === 'ALARM_NOT_FOUND') {
      return new ProblemException(
        HttpStatus.NOT_FOUND,
        error.code,
        `알림을 찾을 수 없습니다: ${error.alarmId}`,
      );
    }
    return new ProblemException(
      HttpStatus.CONFLICT,
      error.code,
      `${error.status} 상태의 알림은 ${AlarmPresenter.BLOCKED_ACTION_PHRASES[error.action]}`,
    );
  }

  private static withState(base: AlarmResponseBase, state: AlarmViewState): AlarmResponse {
    switch (state.status) {
      case 'DRAFT':
        return { ...base, status: 'DRAFT' };
      case 'DISPATCHING':
        return { ...base, status: 'DISPATCHING', dispatchedAt: state.dispatchedAt.toISOString() };
      case 'COMPLETED':
        return {
          ...base,
          status: 'COMPLETED',
          dispatchedAt: state.dispatchedAt.toISOString(),
          completedAt: state.completedAt.toISOString(),
        };
      case 'CANCELLED':
        break;
    }
    return 'dispatchedAt' in state
      ? {
          ...base,
          status: 'CANCELLED',
          dispatchedAt: state.dispatchedAt.toISOString(),
          cancelledAt: state.cancelledAt.toISOString(),
        }
      : { ...base, status: 'CANCELLED', cancelledAt: state.cancelledAt.toISOString() };
  }
}
