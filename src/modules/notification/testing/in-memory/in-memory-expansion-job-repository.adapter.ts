import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { ExpansionJob } from '@/modules/notification/domain/expansion/expansion-job.entity';
import { ExpansionJobSnapshot } from '@/modules/notification/domain/expansion/expansion-job.type';
import { ExpansionJobRepositoryPort } from '@/modules/notification/application/port/driven/for-storing-expansion-jobs/expansion-job-repository.port';
import {
  ExpansionClaim,
  ExpansionJobFound,
  ExpansionJobLookup,
} from '@/modules/notification/application/port/driven/for-storing-expansion-jobs/expansion-job-repository.type';
import { Rollback } from '@/modules/notification/testing/in-memory/rollback.type';

type LeaseEntry = [leasedAlarmId: AlarmId, leaseExpiresAt: Date];

export class InMemoryExpansionJobRepositoryAdapter implements ExpansionJobRepositoryPort {
  private readonly jobsByAlarmId: Map<AlarmId, ExpansionJobFound> = new Map<
    AlarmId,
    ExpansionJobFound
  >();

  private readonly leaseExpiresAtByAlarmId: Map<AlarmId, Date> = new Map<AlarmId, Date>();

  enqueue(alarmId: AlarmId, now: Readonly<Date>): Promise<void> {
    if (this.jobsByAlarmId.has(alarmId)) {
      return Promise.resolve();
    }
    this.jobsByAlarmId.set(alarmId, { kind: 'found', job: ExpansionJob.enqueue(alarmId, now) });
    return Promise.resolve();
  }

  findByAlarmId(alarmId: AlarmId): Promise<ExpansionJobLookup> {
    const lookup: ExpansionJobLookup = this.jobsByAlarmId.get(alarmId) ?? { kind: 'missing' };
    return Promise.resolve(lookup);
  }

  findByAlarmIdForUpdate(alarmId: AlarmId): Promise<ExpansionJobLookup> {
    return this.findByAlarmId(alarmId);
  }

  save(job: ExpansionJob): Promise<void> {
    const { alarmId, progress }: ExpansionJobSnapshot = job.snapshot();
    const lookup: ExpansionJobLookup = this.jobsByAlarmId.get(alarmId) ?? { kind: 'missing' };
    if (lookup.kind === 'missing') {
      return Promise.reject(new Error(`expansion job for alarm ${alarmId} does not exist`));
    }
    const { enqueuedAt }: ExpansionJobSnapshot = lookup.job.snapshot();
    this.jobsByAlarmId.set(alarmId, {
      kind: 'found',
      job: ExpansionJob.reconstitute({ alarmId, enqueuedAt, progress }),
    });
    this.leaseExpiresAtByAlarmId.delete(alarmId);
    return Promise.resolve();
  }

  claimNext(now: Readonly<Date>, leaseUntil: Readonly<Date>): Promise<ExpansionClaim> {
    const claimable: ReadonlyArray<ExpansionJobSnapshot> = [...this.jobsByAlarmId.values()]
      .map(({ job }: ExpansionJobFound): ExpansionJobSnapshot => job.snapshot())
      .filter(
        ({ alarmId, progress }: ExpansionJobSnapshot): boolean =>
          progress.kind === 'in-progress' && !this.isLeasedAt(alarmId, now),
      )
      .toSorted(
        (left: ExpansionJobSnapshot, right: ExpansionJobSnapshot): number =>
          left.enqueuedAt.getTime() - right.enqueuedAt.getTime() ||
          left.alarmId.localeCompare(right.alarmId),
      );
    if (claimable.length === 0) {
      return Promise.resolve({ kind: 'none' });
    }
    const [{ alarmId }]: ReadonlyArray<ExpansionJobSnapshot> = claimable;
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
}
