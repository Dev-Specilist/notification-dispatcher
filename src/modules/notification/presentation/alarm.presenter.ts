import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import {
  AlarmSnapshot,
  AlarmState,
  AlarmValidationError,
} from '@/modules/notification/domain/alarm/alarm.type';
import {
  AlarmResponse,
  AlarmResponseBase,
} from '@/modules/notification/presentation/alarm-response.type';
import { FieldViolation } from '@/shared/http/problem-details.type';

export class AlarmPresenter {
  static toResponse(alarm: Alarm): AlarmResponse {
    const snapshot: AlarmSnapshot = alarm.snapshot();
    const { id, title, body, kind, target, createdAt }: AlarmSnapshot = snapshot;
    const base: AlarmResponseBase = {
      id,
      title,
      body,
      kind,
      recipientIds: target.kind === 'EXPLICIT' ? [...target.recipientIds] : [],
      createdAt: createdAt.toISOString(),
    };
    return AlarmPresenter.withState(base, snapshot.state);
  }

  static violationOf(error: AlarmValidationError): FieldViolation {
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

  private static withState(base: AlarmResponseBase, state: AlarmState): AlarmResponse {
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
    return state.dispatch.kind === 'STARTED'
      ? {
          ...base,
          status: 'CANCELLED',
          dispatchedAt: state.dispatch.at.toISOString(),
          cancelledAt: state.cancelledAt.toISOString(),
        }
      : { ...base, status: 'CANCELLED', cancelledAt: state.cancelledAt.toISOString() };
  }
}
