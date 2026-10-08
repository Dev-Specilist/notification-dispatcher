import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { CompleteAlarmResult } from '@/modules/notification/application/port/in/alarm-result.type';

export abstract class CompleteAlarmIfSettledUseCase {
  abstract execute(alarmId: AlarmId): Promise<CompleteAlarmResult>;
}
