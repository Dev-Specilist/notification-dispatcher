import { z } from 'zod';
import {
  HostSchema,
  MillisecondsSchema,
  PortSchema,
  PositiveMillisecondsSchema,
} from '@/shared/config/primitive.schema';
import { DatabaseUrlSchema } from '@/shared/config/primitive.type';
import { LogFormatSchema, LogLevelSchema } from '@/shared/logging/logging.schema';

export type EnvShape = {
  readonly HOST: z.ZodDefault<HostSchema>;
  readonly PORT: z.ZodDefault<PortSchema>;
  readonly SHUTDOWN_DRAIN_MS: z.ZodDefault<MillisecondsSchema>;
  readonly SHUTDOWN_TIMEOUT_MS: z.ZodDefault<PositiveMillisecondsSchema>;
  readonly LOG_LEVEL: z.ZodDefault<LogLevelSchema>;
  readonly LOG_FORMAT: z.ZodDefault<LogFormatSchema>;
  readonly DATABASE_URL: DatabaseUrlSchema;
};

export type EnvSchema = z.ZodObject<EnvShape>;

export type Env = Readonly<z.infer<EnvSchema>>;

export type RawEnv = Readonly<Record<string, string>>;
