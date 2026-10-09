import { eq, sql } from 'drizzle-orm';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { ExpansionJob } from '@/modules/notification/domain/expansion/expansion-job.entity';
import { ExpansionJobSnapshot } from '@/modules/notification/domain/expansion/expansion-job.type';
import { ExpansionJobRepositoryPort } from '@/modules/notification/application/port/driven/for-storing-expansion-jobs/expansion-job-repository.port';
import {
  ExpansionClaim,
  ExpansionJobLookup,
} from '@/modules/notification/application/port/driven/for-storing-expansion-jobs/expansion-job-repository.type';
import { expansionJobs } from '@/modules/notification/adapter/driven/persistence/expansion-job/expansion-job.table';
import { ExpansionJobRowMapper } from '@/modules/notification/adapter/driven/persistence/expansion-job/expansion-job-row.mapper';
import {
  ExpansionJobRow,
  NotificationDatabase,
} from '@/modules/notification/adapter/driven/persistence/notification-database.type';

interface UpdatedAlarmId {
  readonly alarmId: string;
}

export class DrizzleExpansionJobRepositoryAdapter implements ExpansionJobRepositoryPort {
  constructor(private readonly database: NotificationDatabase) {}

  async enqueue(alarmId: AlarmId, now: Readonly<Date>): Promise<void> {
    const { enqueuedAt, progress }: ExpansionJobSnapshot = ExpansionJob.enqueue(
      alarmId,
      now,
    ).snapshot();
    await this.database
      .insert(expansionJobs)
      .values({ alarmId, enqueuedAt, ...ExpansionJobRowMapper.toProgressColumns(progress) })
      .onConflictDoNothing({ target: expansionJobs.alarmId });
  }

  async findByAlarmId(alarmId: AlarmId): Promise<ExpansionJobLookup> {
    return DrizzleExpansionJobRepositoryAdapter.toLookup(
      await this.database
        .select()
        .from(expansionJobs)
        .where(eq(expansionJobs.alarmId, alarmId))
        .limit(1),
    );
  }

  async findByAlarmIdForUpdate(alarmId: AlarmId): Promise<ExpansionJobLookup> {
    return DrizzleExpansionJobRepositoryAdapter.toLookup(
      await this.database
        .select()
        .from(expansionJobs)
        .where(eq(expansionJobs.alarmId, alarmId))
        .limit(1)
        .for('update'),
    );
  }

  async save(job: ExpansionJob): Promise<void> {
    const { alarmId, progress }: ExpansionJobSnapshot = job.snapshot();
    const updated: ReadonlyArray<UpdatedAlarmId> = await this.database
      .update(expansionJobs)
      .set({
        ...ExpansionJobRowMapper.toProgressColumns(progress),
        leaseExpiresAt: ExpansionJobRowMapper.CLEARED,
        updatedAt: sql`now()`,
      })
      .where(eq(expansionJobs.alarmId, alarmId))
      .returning({ alarmId: expansionJobs.alarmId });
    if (updated.length === 0) {
      throw new Error(`expansion job for alarm ${alarmId} does not exist`);
    }
  }

  async claimNext(now: Readonly<Date>, leaseUntil: Readonly<Date>): Promise<ExpansionClaim> {
    const claimed: ReadonlyArray<UpdatedAlarmId> = await this.database
      .update(expansionJobs)
      .set({ leaseExpiresAt: new Date(leaseUntil.getTime()), updatedAt: sql`now()` })
      .where(
        eq(
          expansionJobs.alarmId,
          sql`(SELECT ${expansionJobs.alarmId} FROM ${expansionJobs}
            WHERE ${expansionJobs.status} = 'IN_PROGRESS'
              AND (${expansionJobs.leaseExpiresAt} IS NULL OR ${expansionJobs.leaseExpiresAt} <= ${now.toISOString()}::timestamptz)
            ORDER BY ${expansionJobs.enqueuedAt}, ${expansionJobs.alarmId}
            LIMIT 1
            FOR UPDATE SKIP LOCKED)`,
        ),
      )
      .returning({ alarmId: expansionJobs.alarmId });
    if (claimed.length === 0) {
      return { kind: 'none' };
    }
    const [{ alarmId: rawAlarmId }]: ReadonlyArray<UpdatedAlarmId> = claimed;
    if (!AlarmPredicates.isAlarmId(rawAlarmId)) {
      throw new Error(`claimed expansion job has an invalid alarm id: ${rawAlarmId}`);
    }
    return { kind: 'claimed', alarmId: rawAlarmId };
  }

  private static toLookup(rows: ReadonlyArray<ExpansionJobRow>): ExpansionJobLookup {
    if (rows.length === 0) {
      return { kind: 'missing' };
    }
    const [row]: ReadonlyArray<ExpansionJobRow> = rows;
    return { kind: 'found', job: ExpansionJobRowMapper.toJob(row) };
  }
}
