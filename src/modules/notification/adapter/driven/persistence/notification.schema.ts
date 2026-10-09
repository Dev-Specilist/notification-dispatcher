import { alarms } from '@/modules/notification/adapter/driven/persistence/alarm/alarm.table';
import { deliveries } from '@/modules/notification/adapter/driven/persistence/delivery/delivery.table';
import { expansionJobs } from '@/modules/notification/adapter/driven/persistence/expansion-job/expansion-job.table';
import { rateLimiters } from '@/modules/notification/adapter/driven/persistence/rate-limiter/rate-limiter.table';

export const notificationSchema = { alarms, deliveries, expansionJobs, rateLimiters };
