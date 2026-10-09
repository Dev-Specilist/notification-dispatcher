import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmSnapshot, AlarmState } from '@/modules/notification/domain/alarm/alarm.type';
import {
  AlarmView,
  AlarmViewState,
} from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-view.type';

export class AlarmViewMapper {
  static toView(alarm: Alarm): AlarmView {
    const { id, title, body, kind, target, state, createdAt }: AlarmSnapshot = alarm.snapshot();
    return {
      id,
      title,
      body,
      kind,
      recipientIds: target.kind === 'EXPLICIT' ? [...target.recipientIds] : [],
      state: AlarmViewMapper.toViewState(state),
      createdAt,
    };
  }

  private static toViewState(state: AlarmState): AlarmViewState {
    switch (state.status) {
      case 'DRAFT':
        return { status: 'DRAFT' };
      case 'DISPATCHING':
        return { status: 'DISPATCHING', dispatchedAt: state.dispatchedAt };
      case 'COMPLETED':
        return {
          status: 'COMPLETED',
          dispatchedAt: state.dispatchedAt,
          completedAt: state.completedAt,
        };
      case 'CANCELLED':
        break;
    }
    return state.dispatch.kind === 'STARTED'
      ? { status: 'CANCELLED', cancelledAt: state.cancelledAt, dispatchedAt: state.dispatch.at }
      : { status: 'CANCELLED', cancelledAt: state.cancelledAt };
  }
}
