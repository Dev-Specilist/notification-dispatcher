import { Injectable } from '@nestjs/common';
import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { ExpansionJobRepositoryPort } from '@/modules/notification/application/port/expansion-job-repository.port';
import {
  ExpansionJob,
  ExpansionJobFound,
  ExpansionJobLookup,
  ExpansionProgress,
} from '@/modules/notification/application/port/expansion-job-repository.type';
import { PageCursor } from '@/modules/notification/application/port/recipient-directory.type';
import { Rollback } from '@/modules/notification/infrastructure/adapter/rollback.type';

@Injectable()
export class InMemoryExpansionJobRepositoryAdapter implements ExpansionJobRepositoryPort {
  private readonly jobsByAlarmId: Map<AlarmId, ExpansionJobFound> = new Map<
    AlarmId,
    ExpansionJobFound
  >();

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

  recordProgress(alarmId: AlarmId, progress: ExpansionProgress): Promise<void> {
    const lookup: ExpansionJobLookup = this.jobsByAlarmId.get(alarmId) ?? { kind: 'missing' };
    if (lookup.kind === 'missing') {
      return Promise.reject(new Error(`expansion job for alarm ${alarmId} does not exist`));
    }
    this.jobsByAlarmId.set(alarmId, {
      kind: 'found',
      job: InMemoryExpansionJobRepositoryAdapter.copyJob({ ...lookup.job, progress }),
    });
    return Promise.resolve();
  }

  checkpoint(): Rollback {
    const saved: Map<AlarmId, ExpansionJobFound> = new Map<AlarmId, ExpansionJobFound>(
      this.jobsByAlarmId,
    );
    return (): void => {
      this.jobsByAlarmId.clear();
      saved.forEach((value: ExpansionJobFound, key: AlarmId): void => {
        this.jobsByAlarmId.set(key, value);
      });
    };
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
