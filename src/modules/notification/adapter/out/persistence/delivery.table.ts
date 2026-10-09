import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  smallint,
} from 'drizzle-orm/pg-core';
import { alarms } from '@/modules/notification/adapter/out/persistence/alarm.table';

export const deliveries = pgTable(
  'deliveries',
  {
    id: uuid('id').primaryKey(),
    alarmId: uuid('alarm_id')
      .notNull()
      .references(() => alarms.id),
    recipientId: text('recipient_id').notNull(),
    priority: text('priority', { enum: ['URGENT', 'BULK'] }).notNull(),
    priorityRank: smallint('priority_rank').generatedAlwaysAs(
      sql`CASE priority WHEN 'URGENT' THEN 0 ELSE 1 END`,
    ),
    attempts: integer('attempts').notNull(),
    status: text('status', {
      enum: [
        'PENDING',
        'IN_FLIGHT',
        'RETRY_WAIT',
        'UNKNOWN',
        'SENT',
        'FAILED',
        'UNCONFIRMED',
        'CANCELLED',
      ],
    }).notNull(),
    leaseToken: uuid('lease_token'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true, mode: 'date' }),
    requestStartedAt: timestamp('request_started_at', { withTimezone: true, mode: 'date' }),
    retryAt: timestamp('retry_at', { withTimezone: true, mode: 'date' }),
    retryCause: text('retry_cause', {
      enum: ['TRANSIENT_FAILURE', 'RATE_LIMITED', 'UNREACHABLE', 'NOT_DELIVERED'],
    }),
    unknownSince: timestamp('unknown_since', { withTimezone: true, mode: 'date' }),
    reconcileAt: timestamp('reconcile_at', { withTimezone: true, mode: 'date' }),
    lookupFailures: integer('lookup_failures'),
    messageId: text('message_id'),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }),
    duplicateCount: integer('duplicate_count'),
    failureReason: text('failure_reason', {
      enum: ['RECIPIENT_BLOCKED', 'UNKNOWN_RECIPIENT', 'INVALID_REQUEST', 'RETRY_EXHAUSTED'],
    }),
    unconfirmedAt: timestamp('unconfirmed_at', { withTimezone: true, mode: 'date' }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('deliveries_alarm_recipient_unique').on(table.alarmId, table.recipientId),
    index('deliveries_claimable_idx')
      .on(table.priorityRank, table.createdAt, table.id)
      .where(sql`${table.status} IN ('PENDING', 'RETRY_WAIT')`),
    index('deliveries_reconcilable_idx')
      .on(table.reconcileAt, table.id)
      .where(sql`${table.status} = 'UNKNOWN'`),
    index('deliveries_leased_idx')
      .on(table.leaseExpiresAt, table.id)
      .where(sql`${table.status} = 'IN_FLIGHT'`),
    check('deliveries_priority_check', sql`${table.priority} IN ('URGENT', 'BULK')`),
    check(
      'deliveries_status_check',
      sql`${table.status} IN ('PENDING', 'IN_FLIGHT', 'RETRY_WAIT', 'UNKNOWN', 'SENT', 'FAILED', 'UNCONFIRMED', 'CANCELLED')`,
    ),
    check('deliveries_attempts_check', sql`${table.attempts} >= 0`),
    check(
      'deliveries_retry_cause_check',
      sql`${table.retryCause} IN ('TRANSIENT_FAILURE', 'RATE_LIMITED', 'UNREACHABLE', 'NOT_DELIVERED')`,
    ),
    check(
      'deliveries_failure_reason_check',
      sql`${table.failureReason} IN ('RECIPIENT_BLOCKED', 'UNKNOWN_RECIPIENT', 'INVALID_REQUEST', 'RETRY_EXHAUSTED')`,
    ),
    check('deliveries_lookup_failures_check', sql`${table.lookupFailures} >= 0`),
    check('deliveries_duplicate_count_check', sql`${table.duplicateCount} >= 0`),
    check(
      'deliveries_in_flight_columns_check',
      sql`${table.status} <> 'IN_FLIGHT' OR (${table.leaseToken} IS NOT NULL AND ${table.leaseExpiresAt} IS NOT NULL)`,
    ),
    check(
      'deliveries_retry_wait_columns_check',
      sql`${table.status} <> 'RETRY_WAIT' OR (${table.retryAt} IS NOT NULL AND ${table.retryCause} IS NOT NULL)`,
    ),
    check(
      'deliveries_unknown_columns_check',
      sql`${table.status} <> 'UNKNOWN' OR (${table.unknownSince} IS NOT NULL AND ${table.reconcileAt} IS NOT NULL AND ${table.lookupFailures} IS NOT NULL)`,
    ),
    check(
      'deliveries_sent_columns_check',
      sql`${table.status} <> 'SENT' OR (${table.messageId} IS NOT NULL AND ${table.sentAt} IS NOT NULL AND ${table.duplicateCount} IS NOT NULL)`,
    ),
    check(
      'deliveries_failed_columns_check',
      sql`${table.status} <> 'FAILED' OR ${table.failureReason} IS NOT NULL`,
    ),
    check(
      'deliveries_unconfirmed_columns_check',
      sql`${table.status} <> 'UNCONFIRMED' OR (${table.unknownSince} IS NOT NULL AND ${table.unconfirmedAt} IS NOT NULL)`,
    ),
    check(
      'deliveries_cancelled_columns_check',
      sql`${table.status} <> 'CANCELLED' OR ${table.cancelledAt} IS NOT NULL`,
    ),
  ],
);
