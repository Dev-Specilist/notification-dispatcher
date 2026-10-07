import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { AlarmFound } from '@/modules/notification/application/port/alarm-repository.type';

export interface AlarmNotFoundError {
  readonly code: 'ALARM_NOT_FOUND';
  readonly alarmId: AlarmId;
}

export interface AlarmNotFound {
  readonly kind: 'not-found';
  readonly error: AlarmNotFoundError;
}

export type AlarmResult = AlarmFound | AlarmNotFound;
