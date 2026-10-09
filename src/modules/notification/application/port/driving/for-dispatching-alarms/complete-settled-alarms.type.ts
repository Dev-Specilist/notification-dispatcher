import {
  ListNext,
  ListStart,
} from '@/modules/notification/application/port/driving/for-managing-alarms/list-alarms.type';

export interface CompleteSettledAlarmsCommand {
  readonly start: ListStart;
}

export interface AlarmCompletionFailure {
  readonly alarmId: string;
  readonly reason: string;
}

export interface SettledAlarmsPageChecked {
  readonly kind: 'checked';
  readonly checkedAlarmCount: number;
  readonly completedAlarmCount: number;
  readonly failures: ReadonlyArray<AlarmCompletionFailure>;
  readonly next: ListNext;
}
