import { alarms } from '@/modules/notification/adapter/out/persistence/alarm.table';
import { deliveries } from '@/modules/notification/adapter/out/persistence/delivery.table';
import { expansionJobs } from '@/modules/notification/adapter/out/persistence/expansion-job.table';
import { rateLimiters } from '@/modules/notification/adapter/out/persistence/rate-limiter.table';

export const notificationSchema = { alarms, deliveries, expansionJobs, rateLimiters };
