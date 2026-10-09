import { AlarmCommand } from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-command.type';
import { CancelAlarmResult } from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-result.type';

export abstract class CancelAlarmUseCase {
  abstract execute(command: Readonly<AlarmCommand>): Promise<CancelAlarmResult>;
}
