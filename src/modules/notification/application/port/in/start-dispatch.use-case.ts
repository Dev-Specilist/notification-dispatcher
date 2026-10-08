import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { StartDispatchResult } from '@/modules/notification/application/port/in/alarm-result.type';

export abstract class StartDispatchUseCase {
  abstract execute(alarmId: AlarmId): Promise<StartDispatchResult>;
}
