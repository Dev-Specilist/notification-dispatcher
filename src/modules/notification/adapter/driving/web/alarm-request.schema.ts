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
import { AlarmCursorCodec } from '@/modules/notification/adapter/driving/web/alarm-cursor.codec';

interface ListAlarmsQueryParams {
  readonly status: ListFilter<AlarmStatusName>;
  readonly kind: ListFilter<AlarmKindName>;
  readonly cursor: ListStart;
  readonly limit: number;
}

const NUL: string = '\u0000';
const DEFAULT_LIMIT: number = 20;
const MAX_LIMIT: number = 100;
const ANY_VALUE_FILTER: ListFilter<never> = { kind: 'any' };
const FROM_NEWEST: ListStart = { kind: 'newest' };

const storableText = z.string().refine((value: string): boolean => !value.includes(NUL), {
  message: 'NUL 문자(U+0000)는 저장할 수 없습니다',
});

export const createAlarmSchema = z.object({
  title: storableText,
  body: storableText,
  kind: z.enum(['BULK', 'URGENT']),
  recipientIds: z.array(storableText).default([]),
});

export const alarmIdParamSchema = z.object({
  id: z.uuid(),
});

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
    const cursorDecoding: CursorDecoding = AlarmCursorCodec.decode(encoded);
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
