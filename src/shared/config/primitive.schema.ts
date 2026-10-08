import { z } from 'zod';

const numericInput = z.union([z.number(), z.string().trim().min(1)]);

const integer = numericInput
  .transform((raw: number | string): number => Number(raw))
  .pipe(z.number().int());

export const hostSchema = z.string().trim().min(1).brand<'Host'>();

export type HostSchema = typeof hostSchema;

export type Host = z.infer<HostSchema>;

export const portSchema = integer.pipe(z.number().min(1).max(65535)).brand<'Port'>();

export type PortSchema = typeof portSchema;

export type Port = z.infer<PortSchema>;

export const millisecondsSchema = integer.pipe(z.number().min(0)).brand<'Milliseconds'>();

export type MillisecondsSchema = typeof millisecondsSchema;

export type Milliseconds = z.infer<MillisecondsSchema>;

export const positiveMillisecondsSchema = integer.pipe(z.number().min(1)).brand<'Milliseconds'>();

export type PositiveMillisecondsSchema = typeof positiveMillisecondsSchema;

export const databaseUrlSchema = z.url({ protocol: /^postgres(ql)?$/ }).brand<'DatabaseUrl'>();

export const processRoleSchema = z.enum(['api', 'worker', 'migrate']);

export type ProcessRole = z.infer<typeof processRoleSchema>;
