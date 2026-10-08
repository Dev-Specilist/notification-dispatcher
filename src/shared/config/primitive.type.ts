import { z } from 'zod';
import type { databaseUrlSchema } from '@/shared/config/primitive.schema';

export type DatabaseUrlSchema = typeof databaseUrlSchema;

export type DatabaseUrl = z.infer<DatabaseUrlSchema>;
