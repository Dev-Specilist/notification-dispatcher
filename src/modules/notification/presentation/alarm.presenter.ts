import {
  AlarmView,
  AlarmViewState,
} from '@/modules/notification/application/port/in/alarm-view.type';
import { AlarmCreationError } from '@/modules/notification/application/port/in/create-alarm.type';
import {
  AlarmResponse,
  AlarmResponseBase,
} from '@/modules/notification/presentation/alarm-response.type';
import { FieldViolation } from '@/shared/http/problem-details.type';

export class AlarmPresenter {
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
