import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { CancelAlarmResult } from '@/modules/notification/application/port/in/alarm-result.type';

export abstract class CancelAlarmUseCase {
  abstract execute(alarmId: AlarmId): Promise<CancelAlarmResult>;
}
