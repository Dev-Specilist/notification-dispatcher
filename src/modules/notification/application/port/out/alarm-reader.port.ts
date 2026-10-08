import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { AlarmLookup } from '@/modules/notification/application/port/out/alarm-repository.type';

export abstract class AlarmReaderPort {
  abstract findById(id: AlarmId): Promise<AlarmLookup>;
}
