import {
  ListAlarmsQuery,
  ListAlarmsResult,
} from '@/modules/notification/application/port/in/list-alarms.type';

export abstract class ListAlarmsUseCase {
  abstract execute(query: Readonly<ListAlarmsQuery>): Promise<ListAlarmsResult>;
}
