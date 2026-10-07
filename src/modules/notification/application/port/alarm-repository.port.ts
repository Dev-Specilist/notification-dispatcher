import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { AlarmLookup } from '@/modules/notification/application/port/alarm-repository.type';

export abstract class AlarmRepositoryPort {
  abstract save(alarm: Alarm): Promise<void>;

  abstract findById(id: AlarmId): Promise<AlarmLookup>;
}
