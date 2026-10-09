import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import {
  AlarmLookup,
  AlarmPage,
  AlarmPageQuery,
} from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.type';

export abstract class AlarmRepositoryPort {
  abstract save(alarm: Alarm): Promise<void>;

  abstract findById(id: AlarmId): Promise<AlarmLookup>;

  abstract findByIdForUpdate(id: AlarmId): Promise<AlarmLookup>;

  abstract findByIdForShare(id: AlarmId): Promise<AlarmLookup>;

  abstract findPage(query: Readonly<AlarmPageQuery>): Promise<AlarmPage>;
}
