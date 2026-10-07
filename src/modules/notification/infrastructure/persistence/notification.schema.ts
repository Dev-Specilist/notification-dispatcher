import { alarms } from '@/modules/notification/infrastructure/persistence/alarm.table';
import { deliveries } from '@/modules/notification/infrastructure/persistence/delivery.table';
import { expansionJobs } from '@/modules/notification/infrastructure/persistence/expansion-job.table';
import { rateLimiters } from '@/modules/notification/infrastructure/persistence/rate-limiter.table';

export const notificationSchema = { alarms, deliveries, expansionJobs, rateLimiters };
