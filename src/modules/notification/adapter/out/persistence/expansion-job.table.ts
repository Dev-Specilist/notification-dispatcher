import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { alarms } from '@/modules/notification/adapter/out/persistence/alarm.table';

export const expansionJobs = pgTable(
  'expansion_jobs',
  {
    alarmId: uuid('alarm_id')
      .primaryKey()
      .references(() => alarms.id),
    enqueuedAt: timestamp('enqueued_at', { withTimezone: true, mode: 'date' }).notNull(),
    status: text('status', { enum: ['IN_PROGRESS', 'COMPLETED', 'STOPPED'] }).notNull(),
    cursorKind: text('cursor_kind', { enum: ['FIRST', 'NEXT'] }),
    cursorToken: text('cursor_token'),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    stoppedAt: timestamp('stopped_at', { withTimezone: true, mode: 'date' }),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'expansion_jobs_status_check',
      sql`${table.status} IN ('IN_PROGRESS', 'COMPLETED', 'STOPPED')`,
    ),
    check('expansion_jobs_cursor_kind_check', sql`${table.cursorKind} IN ('FIRST', 'NEXT')`),
    check(
      'expansion_jobs_in_progress_columns_check',
      sql`${table.status} <> 'IN_PROGRESS' OR ${table.cursorKind} IS NOT NULL`,
    ),
    check(
      'expansion_jobs_next_cursor_columns_check',
      sql`${table.cursorKind} IS DISTINCT FROM 'NEXT' OR ${table.cursorToken} IS NOT NULL`,
    ),
    check(
      'expansion_jobs_completed_columns_check',
      sql`${table.status} <> 'COMPLETED' OR ${table.completedAt} IS NOT NULL`,
    ),
    check(
      'expansion_jobs_stopped_columns_check',
      sql`${table.status} <> 'STOPPED' OR ${table.stoppedAt} IS NOT NULL`,
    ),
  ],
);
