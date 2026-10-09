import {
  ListAlarmsQuery,
  ListAlarmsResult,
} from '@/modules/notification/application/port/driving/for-managing-alarms/list-alarms.type';

export abstract class ListAlarmsUseCase {
  abstract execute(query: Readonly<ListAlarmsQuery>): Promise<ListAlarmsResult>;
}
