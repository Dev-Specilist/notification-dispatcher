import { AlarmResult } from '@/modules/notification/application/port/in/alarm-result.type';
import { GetAlarmQuery } from '@/modules/notification/application/port/in/get-alarm.type';

export abstract class GetAlarmUseCase {
  abstract execute(query: Readonly<GetAlarmQuery>): Promise<AlarmResult>;
}
