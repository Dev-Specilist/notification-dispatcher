import { alarms } from '@/modules/notification/infrastructure/persistence/alarm.table';
import { deliveries } from '@/modules/notification/infrastructure/persistence/delivery.table';

export const notificationSchema = { alarms, deliveries };
