import { z } from 'zod';

const numericInput = z.union([z.number(), z.string().trim().min(1)]);

const integer = numericInput
  .transform((raw: number | string): number => Number(raw))
  .pipe(z.number().int());

const MAX_TIMER_DELAY_MS: number = 2_147_483_647;

export const hostSchema = z.string().trim().min(1).brand<'Host'>();

export const portSchema = integer.pipe(z.number().min(1).max(65535)).brand<'Port'>();

export const nonNegativeMillisecondsSchema = integer
  .pipe(z.number().min(0))
  .brand<'NonNegativeMilliseconds'>();

export const positiveMillisecondsSchema = integer
  .pipe(z.number().min(1))
  .brand<'PositiveMilliseconds'>();

export const timerDelayMsSchema = integer
  .pipe(z.number().min(1).max(MAX_TIMER_DELAY_MS))
  .brand<'TimerDelayMs'>();

export const timerDelayOrZeroMsSchema = integer
  .pipe(z.number().min(0).max(MAX_TIMER_DELAY_MS))
  .brand<'TimerDelayOrZeroMs'>();

export const databaseUrlSchema = z.url({ protocol: /^postgres(ql)?$/ }).brand<'DatabaseUrl'>();

export const httpUrlSchema = z.url({ protocol: /^https?$/ }).brand<'HttpUrl'>();

export const positiveIntegerSchema = integer.pipe(z.number().min(1)).brand<'PositiveInteger'>();

export const processRoleSchema = z.enum(['api', 'worker', 'migrate']);
