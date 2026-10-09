import { AlarmCommand } from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-command.type';
import { StartDispatchResult } from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-result.type';

export abstract class StartDispatchUseCase {
  abstract execute(command: Readonly<AlarmCommand>): Promise<StartDispatchResult>;
}
