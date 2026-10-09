import { AlarmStatusName } from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-view.type';

export interface AlarmNotFoundError {
  readonly code: 'ALARM_NOT_FOUND';
  readonly alarmId: string;
}

export interface AlarmNotFound {
  readonly kind: 'not-found';
  readonly error: AlarmNotFoundError;
}

export type AlarmActionName = 'dispatch' | 'cancel' | 'complete';

export interface AlarmStateConflictError {
  readonly code: 'ALARM_STATE_CONFLICT';
  readonly status: AlarmStatusName;
  readonly action: AlarmActionName;
}

export interface AlarmConflictedResult {
  readonly kind: 'conflict';
  readonly error: AlarmStateConflictError;
}
