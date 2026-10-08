import { AlarmCommand } from '@/modules/notification/application/port/in/alarm-command.type';
import { CancelAlarmResult } from '@/modules/notification/application/port/in/alarm-result.type';

export abstract class CancelAlarmUseCase {
  abstract execute(command: Readonly<AlarmCommand>): Promise<CancelAlarmResult>;
}
