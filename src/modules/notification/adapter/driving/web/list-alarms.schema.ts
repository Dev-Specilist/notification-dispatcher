import { z } from 'zod';
import {
  AlarmKindName,
  AlarmStatusName,
} from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-view.type';
import {
  ListAlarmsQuery,
  ListFilter,
  ListStart,
} from '@/modules/notification/application/port/driving/for-managing-alarms/list-alarms.type';
import { CursorDecoding } from '@/modules/notification/adapter/driving/web/alarm-cursor.type';
import { AlarmCursor } from '@/modules/notification/adapter/driving/web/alarm-cursor.util';

const DEFAULT_LIMIT: number = 20;
const MAX_LIMIT: number = 100;
const ANY_VALUE_FILTER: ListFilter<never> = { kind: 'any' };
const FROM_NEWEST: ListStart = { kind: 'newest' };

const statusFilter = z
  .enum(['DRAFT', 'DISPATCHING', 'COMPLETED', 'CANCELLED'])
  .transform((value: AlarmStatusName): ListFilter<AlarmStatusName> => ({ kind: 'exactly', value }))
  .default(ANY_VALUE_FILTER);

const kindFilter = z
  .enum(['BULK', 'URGENT'])
  .transform((value: AlarmKindName): ListFilter<AlarmKindName> => ({ kind: 'exactly', value }))
  .default(ANY_VALUE_FILTER);

const cursorStart = z
  .string()
  .transform((encoded: string, context: z.RefinementCtx<string>): ListStart => {
    const cursorDecoding: CursorDecoding = AlarmCursor.decode(encoded);
    if (cursorDecoding.kind === 'invalid') {
      context.issues.push({
        code: 'custom',
        message: 'cursor가 올바르지 않습니다',
        input: encoded,
      });
      return z.NEVER;
    }
    return { kind: 'after', position: cursorDecoding.position };
  })
  .default(FROM_NEWEST);

export const listAlarmsQuerySchema = z
  .object({
    status: statusFilter,
    kind: kindFilter,
    cursor: cursorStart,
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  })
  .transform(({ status, kind, cursor, limit }: ListAlarmsQueryParams): ListAlarmsQuery => ({
    status,
    alarmKind: kind,
    start: cursor,
    limit,
  }));

interface ListAlarmsQueryParams {
  readonly status: ListFilter<AlarmStatusName>;
  readonly kind: ListFilter<AlarmKindName>;
  readonly cursor: ListStart;
  readonly limit: number;
}
