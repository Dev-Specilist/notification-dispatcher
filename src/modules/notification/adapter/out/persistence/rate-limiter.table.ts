import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const rateLimiters = pgTable('rate_limiters', {
  name: text('name').primaryKey(),
  theoreticalArrivalAt: timestamp('theoretical_arrival_at', {
    withTimezone: true,
    mode: 'date',
  }).notNull(),
  heldUntil: timestamp('held_until', { withTimezone: true, mode: 'date' }).notNull(),
});
