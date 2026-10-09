import { SQL, and, desc, eq, sql } from 'drizzle-orm';
import { PgColumn } from 'drizzle-orm/pg-core';
import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmId, AlarmSnapshot } from '@/modules/notification/domain/alarm/alarm.type';
import { AlarmRepositoryPort } from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.port';
import {
  AlarmLookup,
  AlarmPage,
  AlarmPageQuery,
  AlarmPageStart,
  AlarmPosition,
  ValueFilter,
} from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.type';
import { alarms } from '@/modules/notification/adapter/driven/persistence/alarm/alarm.table';
import { AlarmRowMapper } from '@/modules/notification/adapter/driven/persistence/alarm/alarm-row.mapper';
import {
  AlarmRow,
  NotificationDatabase,
} from '@/modules/notification/adapter/driven/persistence/notification-database.type';

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

  async findPage({ status, alarmKind, start, size }: Readonly<AlarmPageQuery>): Promise<AlarmPage> {
    const conditions: ReadonlyArray<SQL> = [
      ...DrizzleAlarmRepositoryAdapter.filterOn(alarms.status, status),
      ...DrizzleAlarmRepositoryAdapter.filterOn(alarms.kind, alarmKind),
      ...DrizzleAlarmRepositoryAdapter.startingFrom(start),
    ];
    const rows: ReadonlyArray<AlarmRow> = await this.database
      .select()
      .from(alarms)
      .where(and(...conditions))
      .orderBy(desc(alarms.createdAt), desc(alarms.id))
      .limit(size + 1);
    const page: ReadonlyArray<Alarm> = rows
      .slice(0, size)
      .map((row: AlarmRow): Alarm => AlarmRowMapper.toAlarm(row));
    const [last]: ReadonlyArray<Alarm> = page.slice(-1);
    if (rows.length <= size) {
      return { alarms: page, next: { kind: 'last' } };
    }
    const { createdAt, id }: AlarmSnapshot = last.snapshot();
    return { alarms: page, next: { kind: 'more', after: { createdAt, id } } };
  }

  private static filterOn<TValue extends string>(
    column: PgColumn,
    filter: ValueFilter<TValue>,
  ): ReadonlyArray<SQL> {
    return filter.kind === 'any' ? [] : [eq(column, filter.value)];
  }

  private static startingFrom(start: AlarmPageStart): ReadonlyArray<SQL> {
    if (start.kind === 'newest') {
      return [];
    }
    const { createdAt, id }: AlarmPosition = start.position;
    return [
      sql`(${alarms.createdAt}, ${alarms.id}) < (${createdAt.toISOString()}::timestamptz, ${id}::uuid)`,
    ];
  }

  private static toLookup(rows: ReadonlyArray<AlarmRow>): AlarmLookup {
    if (rows.length === 0) {
      return { kind: 'missing' };
    }
    const [row]: ReadonlyArray<AlarmRow> = rows;
    return { kind: 'found', alarm: AlarmRowMapper.toAlarm(row) };
  }
}
