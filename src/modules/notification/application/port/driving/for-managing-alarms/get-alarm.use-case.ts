import {
  GetAlarmQuery,
  GetAlarmResult,
} from '@/modules/notification/application/port/driving/for-managing-alarms/get-alarm.type';

export abstract class GetAlarmUseCase {
  abstract execute(query: Readonly<GetAlarmQuery>): Promise<GetAlarmResult>;
}
