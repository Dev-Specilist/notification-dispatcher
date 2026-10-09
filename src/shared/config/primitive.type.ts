import { z } from 'zod';
import type {
  databaseUrlSchema,
  httpUrlSchema,
  positiveIntegerSchema,
  timerDelayMsSchema,
  timerDelayOrZeroMsSchema,
} from '@/shared/config/primitive.schema';

export type DatabaseUrlSchema = typeof databaseUrlSchema;

export type DatabaseUrl = z.infer<DatabaseUrlSchema>;

export type HttpUrlSchema = typeof httpUrlSchema;

export type HttpUrl = z.infer<HttpUrlSchema>;

export type PositiveIntegerSchema = typeof positiveIntegerSchema;

export type PositiveInteger = z.infer<PositiveIntegerSchema>;

export type TimerDelayMsSchema = typeof timerDelayMsSchema;

export type TimerDelayMs = z.infer<TimerDelayMsSchema>;

export type TimerDelayOrZeroMsSchema = typeof timerDelayOrZeroMsSchema;
