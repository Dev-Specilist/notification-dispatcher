import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { PageCursor } from '@/modules/notification/application/port/out/recipient-directory.type';

export interface ExpansionInProgress {
  readonly kind: 'in-progress';
  readonly cursor: PageCursor;
}

export interface ExpansionCompleted {
  readonly kind: 'completed';
  readonly completedAt: Date;
}

export interface ExpansionStopped {
  readonly kind: 'stopped';
  readonly stoppedAt: Date;
}

export type ExpansionProgress = ExpansionInProgress | ExpansionCompleted | ExpansionStopped;

export interface ExpansionJob {
  readonly alarmId: AlarmId;
  readonly enqueuedAt: Date;
  readonly progress: ExpansionProgress;
}

export interface ExpansionJobFound {
  readonly kind: 'found';
  readonly job: ExpansionJob;
}

export interface ExpansionJobMissing {
  readonly kind: 'missing';
}

export type ExpansionJobLookup = ExpansionJobFound | ExpansionJobMissing;
