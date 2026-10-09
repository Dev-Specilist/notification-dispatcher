import type { ExpansionJob } from '@/modules/notification/domain/expansion/expansion-job.entity';
import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';

export interface FirstPageCursor {
  readonly kind: 'first';
}

export interface NextPageCursor {
  readonly kind: 'next';
  readonly token: string;
}

export type ExpansionCursor = FirstPageCursor | NextPageCursor;

export interface EndOfPages {
  readonly kind: 'end';
}

export type FollowingCursor = NextPageCursor | EndOfPages;

export interface ExpansionInProgress {
  readonly kind: 'in-progress';
  readonly cursor: ExpansionCursor;
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

export interface ExpansionJobSnapshot {
  readonly alarmId: AlarmId;
  readonly enqueuedAt: Date;
  readonly progress: ExpansionProgress;
}

export interface PageToFetch {
  readonly kind: 'fetch';
  readonly cursor: ExpansionCursor;
}

export interface ExpansionAlreadyCompleted {
  readonly kind: 'completed';
}

export interface ExpansionAlreadyStopped {
  readonly kind: 'stopped';
}

export type ExpansionNextPage = PageToFetch | ExpansionAlreadyCompleted | ExpansionAlreadyStopped;

export interface ExpansionJobTransitioned {
  readonly kind: 'transitioned';
  readonly job: ExpansionJob;
}

export interface ExpansionJobRejected {
  readonly kind: 'rejected';
  readonly reason: 'NOT_IN_PROGRESS';
}

export type ExpansionJobTransition = ExpansionJobTransitioned | ExpansionJobRejected;
