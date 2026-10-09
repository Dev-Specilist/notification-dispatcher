import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import {
  AlarmLookup,
  AlarmPage,
  AlarmPageQuery,
} from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.type';

export abstract class AlarmReaderPort {
  abstract findById(id: AlarmId): Promise<AlarmLookup>;

  abstract findPage(query: Readonly<AlarmPageQuery>): Promise<AlarmPage>;
}
