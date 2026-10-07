import { eq, sql } from 'drizzle-orm';
import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { AlarmRepositoryPort } from '@/modules/notification/application/port/alarm-repository.port';
import { AlarmLookup } from '@/modules/notification/application/port/alarm-repository.type';
import { alarms } from '@/modules/notification/infrastructure/persistence/alarm.table';
import { AlarmRowMapper } from '@/modules/notification/infrastructure/persistence/alarm-row.mapper';
import {
  AlarmRow,
  NotificationDatabase,
} from '@/modules/notification/infrastructure/persistence/notification-database.type';

export class DrizzleAlarmRepositoryAdapter implements AlarmRepositoryPort {
  constructor(private readonly database: NotificationDatabase) {}

  async save(alarm: Alarm): Promise<void> {
    await this.database
      .insert(alarms)
      .values(AlarmRowMapper.toInsert(alarm))
      .onConflictDoUpdate({
        target: alarms.id,
        set: { ...AlarmRowMapper.toStateColumns(alarm.snapshot().state), updatedAt: sql`now()` },
      });
  }

  async findById(id: AlarmId): Promise<AlarmLookup> {
    return DrizzleAlarmRepositoryAdapter.toLookup(
      await this.database.select().from(alarms).where(eq(alarms.id, id)).limit(1),
    );
  }

  async findByIdForUpdate(id: AlarmId): Promise<AlarmLookup> {
    return DrizzleAlarmRepositoryAdapter.toLookup(
      await this.database.select().from(alarms).where(eq(alarms.id, id)).limit(1).for('update'),
    );
  }

  private static toLookup(rows: ReadonlyArray<AlarmRow>): AlarmLookup {
    if (rows.length === 0) {
      return { kind: 'missing' };
    }
    const [row]: ReadonlyArray<AlarmRow> = rows;
    return { kind: 'found', alarm: AlarmRowMapper.toAlarm(row) };
  }
}
