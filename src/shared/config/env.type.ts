import { z } from 'zod';
import {
  HostSchema,
  PortSchema,
  PositiveMillisecondsSchema,
} from '@/shared/config/primitive.schema';
import {
  DatabaseUrlSchema,
  HttpUrlSchema,
  PositiveIntegerSchema,
  TimerDelayMsSchema,
  TimerDelayOrZeroMsSchema,
} from '@/shared/config/primitive.type';
import { LogFormatSchema, LogLevelSchema } from '@/shared/logging/logging.schema';

export type EnvShape = {
  readonly HOST: z.ZodDefault<HostSchema>;
  readonly PORT: z.ZodDefault<PortSchema>;
  readonly SHUTDOWN_DRAIN_MS: z.ZodDefault<TimerDelayOrZeroMsSchema>;
  readonly SHUTDOWN_TIMEOUT_MS: z.ZodDefault<TimerDelayMsSchema>;
  readonly LOG_LEVEL: z.ZodDefault<LogLevelSchema>;
  readonly LOG_FORMAT: z.ZodDefault<LogFormatSchema>;
  readonly DATABASE_URL: DatabaseUrlSchema;
  readonly DATABASE_POOL_MAX: z.ZodDefault<PositiveIntegerSchema>;
  readonly MOCK_API_URL: z.ZodDefault<HttpUrlSchema>;
  readonly DISPATCH_MAX_REQUEST_MS: z.ZodDefault<PositiveMillisecondsSchema>;
  readonly DISPATCH_LEASE_MS: z.ZodDefault<PositiveMillisecondsSchema>;
  readonly RECONCILE_DELAY_MS: z.ZodDefault<PositiveMillisecondsSchema>;
  readonly RETRY_MAX_ATTEMPTS: z.ZodDefault<PositiveIntegerSchema>;
  readonly RETRY_BASE_DELAY_MS: z.ZodDefault<PositiveMillisecondsSchema>;
  readonly RETRY_MAX_DELAY_MS: z.ZodDefault<PositiveMillisecondsSchema>;
  readonly LOOKUP_RETRY_BASE_DELAY_MS: z.ZodDefault<PositiveMillisecondsSchema>;
  readonly LOOKUP_RETRY_MAX_DELAY_MS: z.ZodDefault<PositiveMillisecondsSchema>;
  readonly UNCONFIRMED_AFTER_MS: z.ZodDefault<PositiveMillisecondsSchema>;
  readonly USER_PAGE_LIMIT: z.ZodDefault<PositiveIntegerSchema>;
  readonly RATE_LIMIT_INTERVAL_MS: z.ZodDefault<PositiveMillisecondsSchema>;
  readonly DISPATCH_CONCURRENCY: z.ZodDefault<PositiveIntegerSchema>;
  readonly WORKER_POLL_INTERVAL_MS: z.ZodDefault<TimerDelayMsSchema>;
  readonly WORKER_ERROR_DELAY_MS: z.ZodDefault<TimerDelayMsSchema>;
  readonly COMPLETION_CHECK_INTERVAL_MS: z.ZodDefault<TimerDelayMsSchema>;
};

export type EnvSchema = z.ZodObject<EnvShape>;

export type Env = Readonly<z.infer<EnvSchema>>;

export type RawEnv = Readonly<Record<string, string>>;
