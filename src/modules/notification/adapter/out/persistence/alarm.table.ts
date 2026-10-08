import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const alarms = pgTable(
  'alarms',
  {
    id: uuid('id').primaryKey(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    kind: text('kind', { enum: ['BULK', 'URGENT'] }).notNull(),
    recipientIds: text('recipient_ids').array().notNull(),
    status: text('status', {
      enum: ['DRAFT', 'DISPATCHING', 'COMPLETED', 'CANCELLED'],
    }).notNull(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true, mode: 'date' }),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('alarms_created_at_id_idx').on(table.createdAt, table.id),
    check('alarms_kind_check', sql`${table.kind} in ('BULK', 'URGENT')`),
    check(
      'alarms_status_check',
      sql`${table.status} in ('DRAFT', 'DISPATCHING', 'COMPLETED', 'CANCELLED')`,
    ),
  ],
);
