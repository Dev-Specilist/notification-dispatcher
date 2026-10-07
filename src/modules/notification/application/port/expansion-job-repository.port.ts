import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { ExpansionJobLookup } from '@/modules/notification/application/port/expansion-job-repository.type';

export abstract class ExpansionJobRepositoryPort {
  abstract enqueue(alarmId: AlarmId, now: Readonly<Date>): Promise<void>;

  abstract findByAlarmId(alarmId: AlarmId): Promise<ExpansionJobLookup>;
}
