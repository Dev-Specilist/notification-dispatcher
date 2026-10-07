import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { notificationSchema } from '@/modules/notification/infrastructure/persistence/notification.schema';
import type { alarms } from '@/modules/notification/infrastructure/persistence/alarm.table';

export type NotificationSchema = typeof notificationSchema;

export type NotificationDatabase = PgDatabase<NodePgQueryResultHKT, NotificationSchema>;

export type AlarmRow = typeof alarms.$inferSelect;

export type AlarmInsert = typeof alarms.$inferInsert;
