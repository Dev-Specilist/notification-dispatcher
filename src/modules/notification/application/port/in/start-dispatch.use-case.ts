import { AlarmCommand } from '@/modules/notification/application/port/in/alarm-command.type';
import { StartDispatchResult } from '@/modules/notification/application/port/in/alarm-result.type';

export abstract class StartDispatchUseCase {
  abstract execute(command: Readonly<AlarmCommand>): Promise<StartDispatchResult>;
}
