import { z } from 'zod';
import type {
  databaseUrlSchema,
  hostSchema,
  httpUrlSchema,
  millisecondsSchema,
  portSchema,
  positiveIntegerSchema,
  positiveMillisecondsSchema,
  processRoleSchema,
  timerDelayMsSchema,
  timerDelayOrZeroMsSchema,
} from '@/shared/config/primitive.schema';

export type HostSchema = typeof hostSchema;

export type Host = z.infer<HostSchema>;

export type PortSchema = typeof portSchema;

export type Port = z.infer<PortSchema>;

export type MillisecondsSchema = typeof millisecondsSchema;

export type Milliseconds = z.infer<MillisecondsSchema>;

export type PositiveMillisecondsSchema = typeof positiveMillisecondsSchema;

export type DatabaseUrlSchema = typeof databaseUrlSchema;

export type DatabaseUrl = z.infer<DatabaseUrlSchema>;

export type HttpUrlSchema = typeof httpUrlSchema;

export type HttpUrl = z.infer<HttpUrlSchema>;

export type PositiveIntegerSchema = typeof positiveIntegerSchema;

export type PositiveInteger = z.infer<PositiveIntegerSchema>;

export type TimerDelayMsSchema = typeof timerDelayMsSchema;

export type TimerDelayMs = z.infer<TimerDelayMsSchema>;

export type TimerDelayOrZeroMsSchema = typeof timerDelayOrZeroMsSchema;

export type ProcessRoleSchema = typeof processRoleSchema;

export type ProcessRole = z.infer<ProcessRoleSchema>;
