import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { ExpansionJob } from '@/modules/notification/domain/expansion/expansion-job.entity';

export interface ExpansionJobFound {
  readonly kind: 'found';
  readonly job: ExpansionJob;
}

export interface ExpansionJobMissing {
  readonly kind: 'missing';
}

export type ExpansionJobLookup = ExpansionJobFound | ExpansionJobMissing;

export interface ExpansionClaimed {
  readonly kind: 'claimed';
  readonly alarmId: AlarmId;
}

export interface NoExpansionToClaim {
  readonly kind: 'none';
}

export type ExpansionClaim = ExpansionClaimed | NoExpansionToClaim;
