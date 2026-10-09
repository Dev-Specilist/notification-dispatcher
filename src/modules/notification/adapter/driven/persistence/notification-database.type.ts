import { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import { PgDatabase, PgInsertValue, PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { notificationSchema } from '@/modules/notification/adapter/driven/persistence/notification.schema';
import { alarms } from '@/modules/notification/adapter/driven/persistence/alarm/alarm.table';
import { deliveries } from '@/modules/notification/adapter/driven/persistence/delivery/delivery.table';
import { expansionJobs } from '@/modules/notification/adapter/driven/persistence/expansion-job/expansion-job.table';

export type NotificationSchema = typeof notificationSchema;

export type NotificationDatabase = PgDatabase<NodePgQueryResultHKT, NotificationSchema>;

export type AlarmRow = typeof alarms.$inferSelect;

export type AlarmInsert = typeof alarms.$inferInsert;

export type DeliveryRow = typeof deliveries.$inferSelect;

export type DeliveryInsert = PgInsertValue<typeof deliveries>;

export type DeliveryUpdate = PgUpdateSetSource<typeof deliveries>;

export type ExpansionJobRow = typeof expansionJobs.$inferSelect;
