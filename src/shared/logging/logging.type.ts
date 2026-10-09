import { LogLevel } from '@nestjs/common';
import { z } from 'zod';
import { ProcessRole } from '@/shared/config/primitive.type';
import { logFormatSchema, logLevelSchema } from '@/shared/logging/logging.schema';

export type LogLevelSchema = typeof logLevelSchema;

export type LogFormatSchema = typeof logFormatSchema;

export type LogFormat = z.infer<LogFormatSchema>;

export interface AppLoggerSettings {
  readonly level: LogLevel;
  readonly format: LogFormat;
  readonly role: ProcessRole;
}
