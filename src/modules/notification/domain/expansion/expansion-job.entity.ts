import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import {
  ExpansionCursor,
  ExpansionJobRejected,
  ExpansionJobSnapshot,
  ExpansionJobTransition,
  ExpansionNextPage,
  ExpansionProgress,
  FollowingCursor,
} from '@/modules/notification/domain/expansion/expansion-job.type';

export class ExpansionJob {
  private constructor(
    private readonly alarmId: AlarmId,
    private readonly enqueuedAt: Date,
    private readonly progress: ExpansionProgress,
  ) {}

  static enqueue(alarmId: AlarmId, now: Readonly<Date>): ExpansionJob {
    return new ExpansionJob(alarmId, ExpansionJob.copyDate(now), {
      kind: 'in-progress',
      cursor: { kind: 'first' },
    });
  }

  static reconstitute(snapshot: Readonly<ExpansionJobSnapshot>): ExpansionJob {
    const { alarmId, enqueuedAt, progress }: Readonly<ExpansionJobSnapshot> = snapshot;
    return new ExpansionJob(
      alarmId,
      ExpansionJob.copyDate(enqueuedAt),
      ExpansionJob.copyProgress(progress),
    );
  }

  nextPage(): ExpansionNextPage {
    const progress: ExpansionProgress = this.progress;
    switch (progress.kind) {
      case 'completed':
        return { kind: 'completed' };
      case 'stopped':
        return { kind: 'stopped' };
      case 'in-progress':
        break;
    }
    return { kind: 'fetch', cursor: ExpansionJob.copyCursor(progress.cursor) };
  }

  isAt(cursor: ExpansionCursor): boolean {
    const progress: ExpansionProgress = this.progress;
    if (progress.kind !== 'in-progress') {
      return false;
    }
    const storedCursor: ExpansionCursor = progress.cursor;
    if (storedCursor.kind === 'first' || cursor.kind === 'first') {
      return storedCursor.kind === cursor.kind;
    }
    return storedCursor.token === cursor.token;
  }

  isCompleted(): boolean {
    return this.progress.kind === 'completed';
  }

  advance(following: FollowingCursor, now: Readonly<Date>): ExpansionJobTransition {
    if (this.progress.kind !== 'in-progress') {
      return ExpansionJob.rejectNotInProgress();
    }
    if (following.kind === 'end') {
      return this.transitionTo({ kind: 'completed', completedAt: ExpansionJob.copyDate(now) });
    }
    return this.transitionTo({
      kind: 'in-progress',
      cursor: { kind: 'next', token: following.token },
    });
  }

  stop(now: Readonly<Date>): ExpansionJobTransition {
    if (this.progress.kind !== 'in-progress') {
      return ExpansionJob.rejectNotInProgress();
    }
    return this.transitionTo({ kind: 'stopped', stoppedAt: ExpansionJob.copyDate(now) });
  }

  snapshot(): ExpansionJobSnapshot {
    return {
      alarmId: this.alarmId,
      enqueuedAt: ExpansionJob.copyDate(this.enqueuedAt),
      progress: ExpansionJob.copyProgress(this.progress),
    };
  }

  private transitionTo(progress: ExpansionProgress): ExpansionJobTransition {
    return {
      kind: 'transitioned',
      job: new ExpansionJob(this.alarmId, ExpansionJob.copyDate(this.enqueuedAt), progress),
    };
  }

  private static rejectNotInProgress(): ExpansionJobRejected {
    return { kind: 'rejected', reason: 'NOT_IN_PROGRESS' };
  }

  private static copyProgress(progress: ExpansionProgress): ExpansionProgress {
    switch (progress.kind) {
      case 'completed':
        return { kind: 'completed', completedAt: ExpansionJob.copyDate(progress.completedAt) };
      case 'stopped':
        return { kind: 'stopped', stoppedAt: ExpansionJob.copyDate(progress.stoppedAt) };
      case 'in-progress':
        break;
    }
    return { kind: 'in-progress', cursor: ExpansionJob.copyCursor(progress.cursor) };
  }

  private static copyCursor(cursor: ExpansionCursor): ExpansionCursor {
    return cursor.kind === 'first' ? { kind: 'first' } : { kind: 'next', token: cursor.token };
  }

  private static copyDate(date: Readonly<Date>): Date {
    return new Date(date.getTime());
  }
}
