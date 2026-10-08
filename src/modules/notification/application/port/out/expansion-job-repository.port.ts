import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import {
  ExpansionJobLookup,
  ExpansionProgress,
} from '@/modules/notification/application/port/out/expansion-job-repository.type';

export abstract class ExpansionJobRepositoryPort {
  abstract enqueue(alarmId: AlarmId, now: Readonly<Date>): Promise<void>;

  abstract findByAlarmId(alarmId: AlarmId): Promise<ExpansionJobLookup>;

  abstract findByAlarmIdForUpdate(alarmId: AlarmId): Promise<ExpansionJobLookup>;

  abstract recordProgress(alarmId: AlarmId, progress: ExpansionProgress): Promise<void>;
}
