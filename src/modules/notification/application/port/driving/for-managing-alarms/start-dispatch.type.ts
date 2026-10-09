import {
  AlarmConflictedResult,
  AlarmNotFound,
} from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-error.type';
import { AlarmView } from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-view.type';

export interface StartDispatchCommand {
  readonly alarmId: string;
}

export interface AlarmDispatched {
  readonly kind: 'dispatched';
  readonly alarm: AlarmView;
}

export type StartDispatchResult = AlarmDispatched | AlarmNotFound | AlarmConflictedResult;
