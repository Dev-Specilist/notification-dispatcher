import {
  AlarmView,
  AlarmViewState,
} from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-view.type';
import { DeliveryProgressView } from '@/modules/notification/application/port/driving/for-managing-alarms/delivery-progress-view.type';

export interface AlarmFoundResult {
  readonly kind: 'found';
  readonly alarm: AlarmView;
  readonly deliveries: DeliveryProgressView;
}

export interface AlarmNotFoundError {
  readonly code: 'ALARM_NOT_FOUND';
  readonly alarmId: string;
}

export interface AlarmNotFound {
  readonly kind: 'not-found';
  readonly error: AlarmNotFoundError;
}

export type AlarmResult = AlarmFoundResult | AlarmNotFound;

export type AlarmStatusName = AlarmViewState['status'];

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

export interface AlarmDispatched {
  readonly kind: 'dispatched';
  readonly alarm: AlarmView;
}

export type StartDispatchResult = AlarmDispatched | AlarmNotFound | AlarmConflictedResult;

export interface AlarmCancelled {
  readonly kind: 'cancelled';
  readonly alarm: AlarmView;
}

export type CancelAlarmResult = AlarmCancelled | AlarmNotFound | AlarmConflictedResult;

export interface AlarmCompleted {
  readonly kind: 'completed';
}

export interface AlarmNotYetSettled {
  readonly kind: 'not-yet';
}

export type CompleteAlarmResult =
  AlarmCompleted | AlarmNotYetSettled | AlarmNotFound | AlarmConflictedResult;
