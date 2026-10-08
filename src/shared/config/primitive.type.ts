import { z } from 'zod';
import type {
  databaseUrlSchema,
  httpUrlSchema,
  positiveIntegerSchema,
} from '@/shared/config/primitive.schema';

export type DatabaseUrlSchema = typeof databaseUrlSchema;

export type DatabaseUrl = z.infer<DatabaseUrlSchema>;

export type HttpUrlSchema = typeof httpUrlSchema;

export type HttpUrl = z.infer<HttpUrlSchema>;

export type PositiveIntegerSchema = typeof positiveIntegerSchema;

export type PositiveInteger = z.infer<PositiveIntegerSchema>;
