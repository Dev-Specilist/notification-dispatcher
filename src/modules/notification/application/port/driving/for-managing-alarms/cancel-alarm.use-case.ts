import {
  CancelAlarmCommand,
  CancelAlarmResult,
} from '@/modules/notification/application/port/driving/for-managing-alarms/cancel-alarm.type';

export abstract class CancelAlarmUseCase {
  abstract execute(command: Readonly<CancelAlarmCommand>): Promise<CancelAlarmResult>;
}
