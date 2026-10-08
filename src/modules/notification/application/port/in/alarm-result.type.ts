import { AlarmConflicted, AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { AlarmView } from '@/modules/notification/application/port/in/alarm-view.type';

export interface AlarmFoundResult {
  readonly kind: 'found';
  readonly alarm: AlarmView;
}

export interface AlarmNotFoundError {
  readonly code: 'ALARM_NOT_FOUND';
  readonly alarmId: AlarmId;
}

export interface AlarmNotFound {
  readonly kind: 'not-found';
  readonly error: AlarmNotFoundError;
}

export type AlarmResult = AlarmFoundResult | AlarmNotFound;

export interface AlarmDispatched {
  readonly kind: 'dispatched';
  readonly alarm: AlarmView;
}

export type StartDispatchResult = AlarmDispatched | AlarmNotFound | AlarmConflicted;

export interface AlarmCancelled {
  readonly kind: 'cancelled';
  readonly alarm: AlarmView;
}

export type CancelAlarmResult = AlarmCancelled | AlarmNotFound | AlarmConflicted;

export interface AlarmCompleted {
  readonly kind: 'completed';
}

export interface AlarmNotYetSettled {
  readonly kind: 'not-yet';
}

export type CompleteAlarmResult =
  AlarmCompleted | AlarmNotYetSettled | AlarmNotFound | AlarmConflicted;
