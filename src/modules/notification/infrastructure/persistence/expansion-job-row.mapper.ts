import { SQL, sql } from 'drizzle-orm';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import {
  ExpansionJob,
  ExpansionProgress,
} from '@/modules/notification/application/port/out/expansion-job-repository.type';
import { ExpansionJobRow } from '@/modules/notification/infrastructure/persistence/notification-database.type';

interface ProgressColumns {
  readonly status: ExpansionJobRow['status'];
  readonly cursorKind: 'FIRST' | 'NEXT' | SQL;
  readonly cursorToken: string | SQL;
  readonly completedAt: Date | SQL;
  readonly stoppedAt: Date | SQL;
}

export class ExpansionJobRowMapper {
  private static readonly CLEARED: SQL = sql`NULL`;

  static toProgressColumns(progress: ExpansionProgress): ProgressColumns {
    const cleared: Omit<ProgressColumns, 'status'> = {
      cursorKind: ExpansionJobRowMapper.CLEARED,
      cursorToken: ExpansionJobRowMapper.CLEARED,
      completedAt: ExpansionJobRowMapper.CLEARED,
      stoppedAt: ExpansionJobRowMapper.CLEARED,
    };
    switch (progress.kind) {
      case 'completed':
        return { ...cleared, status: 'COMPLETED', completedAt: progress.completedAt };
      case 'stopped':
        return { ...cleared, status: 'STOPPED', stoppedAt: progress.stoppedAt };
      case 'in-progress':
        break;
    }
    return progress.cursor.kind === 'first'
      ? { ...cleared, status: 'IN_PROGRESS', cursorKind: 'FIRST' }
      : {
          ...cleared,
          status: 'IN_PROGRESS',
          cursorKind: 'NEXT',
          cursorToken: progress.cursor.token,
        };
  }

  static toJob(row: ExpansionJobRow): ExpansionJob {
    const { enqueuedAt }: ExpansionJobRow = row;
    return {
      alarmId: ExpansionJobRowMapper.alarmIdOf(row),
      enqueuedAt,
      progress: ExpansionJobRowMapper.progressOf(row),
    };
  }

  private static alarmIdOf({ alarmId }: ExpansionJobRow): AlarmId {
    if (!AlarmPredicates.isAlarmId(alarmId)) {
      throw new Error(`expansion job row has an invalid alarm id: ${alarmId}`);
    }
    return alarmId;
  }

  private static progressOf(row: ExpansionJobRow): ExpansionProgress {
    const { alarmId, status, cursorKind, cursorToken, completedAt, stoppedAt }: ExpansionJobRow =
      row;
    if (status === 'COMPLETED' && completedAt instanceof Date) {
      return { kind: 'completed', completedAt };
    }
    if (status === 'STOPPED' && stoppedAt instanceof Date) {
      return { kind: 'stopped', stoppedAt };
    }
    if (status === 'IN_PROGRESS' && cursorKind === 'FIRST') {
      return { kind: 'in-progress', cursor: { kind: 'first' } };
    }
    if (status === 'IN_PROGRESS' && cursorKind === 'NEXT' && typeof cursorToken === 'string') {
      return { kind: 'in-progress', cursor: { kind: 'next', token: cursorToken } };
    }
    throw new Error(`expansion job row ${alarmId} has columns that do not match status ${status}`);
  }
}
