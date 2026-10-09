import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import {
  ExpansionClaim,
  ExpansionJobLookup,
  ExpansionProgress,
} from '@/modules/notification/application/port/driven/for-storing-expansion-jobs/expansion-job-repository.type';

export abstract class ExpansionJobRepositoryPort {
  abstract enqueue(alarmId: AlarmId, now: Readonly<Date>): Promise<void>;

  abstract claimNext(now: Readonly<Date>, leaseUntil: Readonly<Date>): Promise<ExpansionClaim>;

  abstract findByAlarmId(alarmId: AlarmId): Promise<ExpansionJobLookup>;

  abstract findByAlarmIdForUpdate(alarmId: AlarmId): Promise<ExpansionJobLookup>;

  abstract recordProgress(alarmId: AlarmId, progress: ExpansionProgress): Promise<void>;
}
