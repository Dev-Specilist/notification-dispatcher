import { AlarmResult } from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-result.type';
import { GetAlarmQuery } from '@/modules/notification/application/port/driving/for-managing-alarms/get-alarm.type';

export abstract class GetAlarmUseCase {
  abstract execute(query: Readonly<GetAlarmQuery>): Promise<AlarmResult>;
}
