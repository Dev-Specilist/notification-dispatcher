import { Injectable } from '@nestjs/common';
import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { ExpansionJobRepositoryPort } from '@/modules/notification/application/port/expansion-job-repository.port';
import {
  ExpansionJobFound,
  ExpansionJobLookup,
} from '@/modules/notification/application/port/expansion-job-repository.type';
import { Rollback } from '@/modules/notification/infrastructure/adapter/rollback.type';

@Injectable()
export class InMemoryExpansionJobRepositoryAdapter implements ExpansionJobRepositoryPort {
  private readonly jobsByAlarmId: Map<AlarmId, ExpansionJobFound> = new Map<
    AlarmId,
    ExpansionJobFound
  >();

  enqueue(alarmId: AlarmId, now: Readonly<Date>): Promise<void> {
    this.jobsByAlarmId.set(alarmId, {
      kind: 'found',
      job: { alarmId, enqueuedAt: new Date(now.getTime()) },
    });
    return Promise.resolve();
  }

  findByAlarmId(alarmId: AlarmId): Promise<ExpansionJobLookup> {
    const lookup: ExpansionJobLookup = this.jobsByAlarmId.get(alarmId) ?? { kind: 'missing' };
    if (lookup.kind === 'missing') {
      return Promise.resolve(lookup);
    }
    const { job }: ExpansionJobFound = lookup;
    return Promise.resolve({
      kind: 'found',
      job: { alarmId: job.alarmId, enqueuedAt: new Date(job.enqueuedAt.getTime()) },
    });
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
}
