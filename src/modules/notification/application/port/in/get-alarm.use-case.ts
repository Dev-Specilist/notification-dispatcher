import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { AlarmResult } from '@/modules/notification/application/port/in/alarm-result.type';

export abstract class GetAlarmUseCase {
  abstract execute(alarmId: AlarmId): Promise<AlarmResult>;
}
