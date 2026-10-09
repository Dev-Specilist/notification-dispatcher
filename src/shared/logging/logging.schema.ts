import { z } from 'zod';

export const logLevelSchema = z.enum(['fatal', 'error', 'warn', 'log', 'debug', 'verbose']);

export const logFormatSchema = z.enum(['json', 'pretty']);
