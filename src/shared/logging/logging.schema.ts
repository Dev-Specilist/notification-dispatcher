import { z } from 'zod';

export const logLevelSchema = z.enum(['fatal', 'error', 'warn', 'log', 'debug', 'verbose']);

export type LogLevelSchema = typeof logLevelSchema;

export const logFormatSchema = z.enum(['json', 'pretty']);

export type LogFormatSchema = typeof logFormatSchema;

export type LogFormat = z.infer<LogFormatSchema>;
