import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmConflicted, AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { AlarmFound } from '@/modules/notification/application/port/out/alarm-repository.type';

export interface AlarmNotFoundError {
  readonly code: 'ALARM_NOT_FOUND';
  readonly alarmId: AlarmId;
}

export interface AlarmNotFound {
  readonly kind: 'not-found';
  readonly error: AlarmNotFoundError;
}

export type AlarmResult = AlarmFound | AlarmNotFound;

export interface AlarmDispatched {
  readonly kind: 'dispatched';
  readonly alarm: Alarm;
}

export type StartDispatchResult = AlarmDispatched | AlarmNotFound | AlarmConflicted;

export interface AlarmCancelled {
  readonly kind: 'cancelled';
  readonly alarm: Alarm;
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
