import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { notificationSchema } from '@/modules/notification/infrastructure/persistence/notification.schema';
import { NotificationDatabase } from '@/modules/notification/infrastructure/persistence/notification-database.type';

export class NotificationDatabaseFactory {
  static create(pool: Pool): NotificationDatabase {
    return drizzle({ client: pool, schema: notificationSchema });
  }
}
