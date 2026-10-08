import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { notificationSchema } from '@/modules/notification/adapter/out/persistence/notification.schema';
import type { PgInsertValue, PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { alarms } from '@/modules/notification/adapter/out/persistence/alarm.table';
import type { deliveries } from '@/modules/notification/adapter/out/persistence/delivery.table';
import type { expansionJobs } from '@/modules/notification/adapter/out/persistence/expansion-job.table';

export type NotificationSchema = typeof notificationSchema;

export type NotificationDatabase = PgDatabase<NodePgQueryResultHKT, NotificationSchema>;

export type AlarmRow = typeof alarms.$inferSelect;

export type AlarmInsert = typeof alarms.$inferInsert;

export type DeliveryRow = typeof deliveries.$inferSelect;

export type DeliveryInsert = PgInsertValue<typeof deliveries>;

export type DeliveryUpdate = PgUpdateSetSource<typeof deliveries>;

export type ExpansionJobRow = typeof expansionJobs.$inferSelect;
