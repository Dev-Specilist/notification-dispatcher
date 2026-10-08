import { Injectable } from '@nestjs/common';
import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { ExpansionJobRepositoryPort } from '@/modules/notification/application/port/out/expansion-job-repository.port';
import { ExpansionQueuePort } from '@/modules/notification/application/port/out/expansion-queue.port';
import {
  ExpansionClaim,
  ExpansionJob,
  ExpansionJobFound,
  ExpansionJobLookup,
  ExpansionProgress,
} from '@/modules/notification/application/port/out/expansion-job-repository.type';
import { PageCursor } from '@/modules/notification/application/port/out/recipient-directory.type';
import { Rollback } from '@/modules/notification/adapter/out/in-memory/rollback.type';

type LeaseEntry = [leasedAlarmId: AlarmId, leaseExpiresAt: Date];

@Injectable()
export class InMemoryExpansionJobRepositoryAdapter
  implements ExpansionJobRepositoryPort, ExpansionQueuePort
{
  private readonly jobsByAlarmId: Map<AlarmId, ExpansionJobFound> = new Map<
    AlarmId,
    ExpansionJobFound
  >();

  private readonly leaseExpiresAtByAlarmId: Map<AlarmId, Date> = new Map<AlarmId, Date>();

  enqueue(alarmId: AlarmId, now: Readonly<Date>): Promise<void> {
    if (this.jobsByAlarmId.has(alarmId)) {
      return Promise.resolve();
    }
    this.jobsByAlarmId.set(alarmId, {
      kind: 'found',
      job: {
        alarmId,
        enqueuedAt: new Date(now.getTime()),
        progress: { kind: 'in-progress', cursor: { kind: 'first' } },
      },
    });
    return Promise.resolve();
  }

  findByAlarmId(alarmId: AlarmId): Promise<ExpansionJobLookup> {
    const lookup: ExpansionJobLookup = this.jobsByAlarmId.get(alarmId) ?? { kind: 'missing' };
    if (lookup.kind === 'missing') {
      return Promise.resolve(lookup);
    }
    return Promise.resolve({
      kind: 'found',
      job: InMemoryExpansionJobRepositoryAdapter.copyJob(lookup.job),
    });
  }

  findByAlarmIdForUpdate(alarmId: AlarmId): Promise<ExpansionJobLookup> {
    return this.findByAlarmId(alarmId);
  }

  recordProgress(alarmId: AlarmId, progress: ExpansionProgress): Promise<void> {
    const lookup: ExpansionJobLookup = this.jobsByAlarmId.get(alarmId) ?? { kind: 'missing' };
    if (lookup.kind === 'missing') {
      return Promise.reject(new Error(`expansion job for alarm ${alarmId} does not exist`));
    }
    this.jobsByAlarmId.set(alarmId, {
      kind: 'found',
      job: InMemoryExpansionJobRepositoryAdapter.copyJob({ ...lookup.job, progress }),
    });
    this.leaseExpiresAtByAlarmId.delete(alarmId);
    return Promise.resolve();
  }

  claimNext(now: Readonly<Date>, leaseUntil: Readonly<Date>): Promise<ExpansionClaim> {
    const claimable: ReadonlyArray<ExpansionJob> = [...this.jobsByAlarmId.values()]
      .map(({ job }: ExpansionJobFound): ExpansionJob => job)
      .filter(
        ({ alarmId, progress }: ExpansionJob): boolean =>
          progress.kind === 'in-progress' && !this.isLeasedAt(alarmId, now),
      )
      .toSorted(
        (left: ExpansionJob, right: ExpansionJob): number =>
          left.enqueuedAt.getTime() - right.enqueuedAt.getTime() ||
          left.alarmId.localeCompare(right.alarmId),
      );
    if (claimable.length === 0) {
      return Promise.resolve({ kind: 'none' });
    }
    const [{ alarmId }]: ReadonlyArray<ExpansionJob> = claimable;
    this.leaseExpiresAtByAlarmId.set(alarmId, new Date(leaseUntil.getTime()));
    return Promise.resolve({ kind: 'claimed', alarmId });
  }

  checkpoint(): Rollback {
    const saved: Map<AlarmId, ExpansionJobFound> = new Map<AlarmId, ExpansionJobFound>(
      this.jobsByAlarmId,
    );
    const savedLeases: Map<AlarmId, Date> = new Map<AlarmId, Date>(this.leaseExpiresAtByAlarmId);
    return (): void => {
      this.jobsByAlarmId.clear();
      saved.forEach((value: ExpansionJobFound, key: AlarmId): void => {
        this.jobsByAlarmId.set(key, value);
      });
      this.leaseExpiresAtByAlarmId.clear();
      savedLeases.forEach((leaseExpiresAt: Date, leasedAlarmId: AlarmId): void => {
        this.leaseExpiresAtByAlarmId.set(leasedAlarmId, leaseExpiresAt);
      });
    };
  }

  private isLeasedAt(alarmId: AlarmId, now: Readonly<Date>): boolean {
    return [...this.leaseExpiresAtByAlarmId.entries()].some(
      ([leasedAlarmId, leaseExpiresAt]: LeaseEntry): boolean =>
        leasedAlarmId === alarmId && leaseExpiresAt.getTime() > now.getTime(),
    );
  }

  private static copyJob({ alarmId, enqueuedAt, progress }: ExpansionJob): ExpansionJob {
    return {
      alarmId,
      enqueuedAt: new Date(enqueuedAt.getTime()),
      progress: InMemoryExpansionJobRepositoryAdapter.copyProgress(progress),
    };
  }

  private static copyProgress(progress: ExpansionProgress): ExpansionProgress {
    switch (progress.kind) {
      case 'completed':
        return { kind: 'completed', completedAt: new Date(progress.completedAt.getTime()) };
      case 'stopped':
        return { kind: 'stopped', stoppedAt: new Date(progress.stoppedAt.getTime()) };
      case 'in-progress':
        break;
    }
    return {
      kind: 'in-progress',
      cursor: InMemoryExpansionJobRepositoryAdapter.copyCursor(progress.cursor),
    };
  }

  private static copyCursor(cursor: PageCursor): PageCursor {
    return cursor.kind === 'first' ? { kind: 'first' } : { kind: 'next', token: cursor.token };
  }
}
