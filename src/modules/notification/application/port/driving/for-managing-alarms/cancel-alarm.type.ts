import {
  AlarmConflictedResult,
  AlarmNotFound,
} from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-error.type';
import { AlarmView } from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-view.type';

export interface CancelAlarmCommand {
  readonly alarmId: string;
}

export interface AlarmCancelled {
  readonly kind: 'cancelled';
  readonly alarm: AlarmView;
}

export type CancelAlarmResult = AlarmCancelled | AlarmNotFound | AlarmConflictedResult;
