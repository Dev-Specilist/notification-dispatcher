import { z } from 'zod';
import {
  AlarmDetailResponse,
  AlarmListResponse,
  AlarmResponse,
} from '@/modules/notification/adapter/driving/web/alarm-response.type';

const timestamp = z.iso.datetime();

const alarmBaseShape = {
  id: z.uuid(),
  title: z.string(),
  body: z.string(),
  kind: z.enum(['BULK', 'URGENT']),
  recipientIds: z.array(z.string()),
  createdAt: timestamp,
};

const draftAlarm = z.object({ ...alarmBaseShape, status: z.literal('DRAFT') });

const dispatchingAlarm = z.object({
  ...alarmBaseShape,
  status: z.literal('DISPATCHING'),
  dispatchedAt: timestamp,
});

const completedAlarm = z.object({
  ...alarmBaseShape,
  status: z.literal('COMPLETED'),
  dispatchedAt: timestamp,
  completedAt: timestamp,
});

const cancelledAfterDispatchAlarm = z.object({
  ...alarmBaseShape,
  status: z.literal('CANCELLED'),
  dispatchedAt: timestamp,
  cancelledAt: timestamp,
});

const cancelledBeforeDispatchAlarm = z.object({
  ...alarmBaseShape,
  status: z.literal('CANCELLED'),
  cancelledAt: timestamp,
});

const deliveries = z.object({
  total: z.number().int(),
  byStatus: z.record(
    z.enum([
      'PENDING',
      'IN_FLIGHT',
      'RETRY_WAIT',
      'UNKNOWN',
      'SENT',
      'FAILED',
      'UNCONFIRMED',
      'CANCELLED',
    ]),
    z.number().int(),
  ),
});

export const alarmResponseSchema: z.ZodType<AlarmResponse> = z.union([
  draftAlarm,
  dispatchingAlarm,
  completedAlarm,
  cancelledAfterDispatchAlarm,
  cancelledBeforeDispatchAlarm,
]);

export const alarmDetailResponseSchema: z.ZodType<AlarmDetailResponse> = z.union([
  draftAlarm.extend({ deliveries }),
  dispatchingAlarm.extend({ deliveries }),
  completedAlarm.extend({ deliveries }),
  cancelledAfterDispatchAlarm.extend({ deliveries }),
  cancelledBeforeDispatchAlarm.extend({ deliveries }),
]);

export const alarmListResponseSchema: z.ZodType<AlarmListResponse> = z.object({
  alarms: z.array(alarmResponseSchema),
  page: z.union([z.object({ nextCursor: z.string() }), z.object({}).strict()]),
});
