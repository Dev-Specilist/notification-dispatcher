import { AlarmCommand } from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-command.type';
import { CompleteAlarmResult } from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-result.type';

export abstract class CompleteAlarmIfSettledUseCase {
  abstract execute(command: Readonly<AlarmCommand>): Promise<CompleteAlarmResult>;
}
