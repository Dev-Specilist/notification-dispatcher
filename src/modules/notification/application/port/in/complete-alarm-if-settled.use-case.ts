import { AlarmCommand } from '@/modules/notification/application/port/in/alarm-command.type';
import { CompleteAlarmResult } from '@/modules/notification/application/port/in/alarm-result.type';

export abstract class CompleteAlarmIfSettledUseCase {
  abstract execute(command: Readonly<AlarmCommand>): Promise<CompleteAlarmResult>;
}
