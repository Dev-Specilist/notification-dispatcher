import { eq, sql } from 'drizzle-orm';
import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { ExpansionJobRepositoryPort } from '@/modules/notification/application/port/expansion-job-repository.port';
import {
  ExpansionJobLookup,
  ExpansionProgress,
} from '@/modules/notification/application/port/expansion-job-repository.type';
import { expansionJobs } from '@/modules/notification/infrastructure/persistence/expansion-job.table';
import { ExpansionJobRowMapper } from '@/modules/notification/infrastructure/persistence/expansion-job-row.mapper';
import {
  ExpansionJobRow,
  NotificationDatabase,
} from '@/modules/notification/infrastructure/persistence/notification-database.type';

interface UpdatedAlarmId {
  readonly alarmId: string;
}

export class DrizzleExpansionJobRepositoryAdapter implements ExpansionJobRepositoryPort {
  constructor(private readonly database: NotificationDatabase) {}

  async enqueue(alarmId: AlarmId, now: Readonly<Date>): Promise<void> {
    await this.database
      .insert(expansionJobs)
      .values({
        alarmId,
        enqueuedAt: new Date(now.getTime()),
        ...ExpansionJobRowMapper.toProgressColumns({
          kind: 'in-progress',
          cursor: { kind: 'first' },
        }),
      })
      .onConflictDoNothing({ target: expansionJobs.alarmId });
  }

  async findByAlarmId(alarmId: AlarmId): Promise<ExpansionJobLookup> {
    const rows: ReadonlyArray<ExpansionJobRow> = await this.database
      .select()
      .from(expansionJobs)
      .where(eq(expansionJobs.alarmId, alarmId))
      .limit(1);
    if (rows.length === 0) {
      return { kind: 'missing' };
    }
    const [row]: ReadonlyArray<ExpansionJobRow> = rows;
    return { kind: 'found', job: ExpansionJobRowMapper.toJob(row) };
  }

  async recordProgress(alarmId: AlarmId, progress: ExpansionProgress): Promise<void> {
    const updated: ReadonlyArray<UpdatedAlarmId> = await this.database
      .update(expansionJobs)
      .set({ ...ExpansionJobRowMapper.toProgressColumns(progress), updatedAt: sql`now()` })
      .where(eq(expansionJobs.alarmId, alarmId))
      .returning({ alarmId: expansionJobs.alarmId });
    if (updated.length === 0) {
      throw new Error(`expansion job for alarm ${alarmId} does not exist`);
    }
  }
}
