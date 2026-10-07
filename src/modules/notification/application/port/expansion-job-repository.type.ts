import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';

export interface ExpansionJob {
  readonly alarmId: AlarmId;
  readonly enqueuedAt: Date;
}

export interface ExpansionJobFound {
  readonly kind: 'found';
  readonly job: ExpansionJob;
}

export interface ExpansionJobMissing {
  readonly kind: 'missing';
}

export type ExpansionJobLookup = ExpansionJobFound | ExpansionJobMissing;
