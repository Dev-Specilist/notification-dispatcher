import { z } from 'zod';
import { Env, EnvSchema } from '@/shared/config/env.type';
import {
  databaseUrlSchema,
  hostSchema,
  httpUrlSchema,
  portSchema,
  positiveIntegerSchema,
  positiveMillisecondsSchema,
  timerDelayMsSchema,
  timerDelayOrZeroMsSchema,
} from '@/shared/config/primitive.schema';
import {
  Host,
  HttpUrl,
  Port,
  PositiveInteger,
  PositiveMilliseconds,
  TimerDelayMs,
  TimerDelayOrZeroMs,
} from '@/shared/config/primitive.type';
import { logFormatSchema, logLevelSchema } from '@/shared/logging/logging.schema';

const DEFAULT_HOST: Host = hostSchema.parse('0.0.0.0');
const DEFAULT_DRAIN: TimerDelayOrZeroMs = timerDelayOrZeroMsSchema.parse(5_000);
const DEFAULT_TIMEOUT: TimerDelayMs = timerDelayMsSchema.parse(25_000);
const DEFAULT_DATABASE_POOL_MAX: PositiveInteger = positiveIntegerSchema.parse(20);
const DEFAULT_DATABASE_STATEMENT_TIMEOUT: TimerDelayMs = timerDelayMsSchema.parse(15_000);
const DEFAULT_DATABASE_LOCK_TIMEOUT: TimerDelayMs = timerDelayMsSchema.parse(5_000);
const DEFAULT_MOCK_API_URL: HttpUrl = httpUrlSchema.parse('http://localhost:4000');
const DEFAULT_MAX_REQUEST: PositiveMilliseconds = positiveMillisecondsSchema.parse(5_000);
const DEFAULT_LEASE: PositiveMilliseconds = positiveMillisecondsSchema.parse(30_000);
const DEFAULT_RECONCILE_DELAY: PositiveMilliseconds = positiveMillisecondsSchema.parse(35_000);
const DEFAULT_RETRY_MAX_ATTEMPTS: PositiveInteger = positiveIntegerSchema.parse(5);
const DEFAULT_RETRY_BASE_DELAY: PositiveMilliseconds = positiveMillisecondsSchema.parse(1_000);
const DEFAULT_RETRY_MAX_DELAY: PositiveMilliseconds = positiveMillisecondsSchema.parse(60_000);
const DEFAULT_LOOKUP_RETRY_BASE_DELAY: PositiveMilliseconds =
  positiveMillisecondsSchema.parse(5_000);
const DEFAULT_LOOKUP_RETRY_MAX_DELAY: PositiveMilliseconds =
  positiveMillisecondsSchema.parse(60_000);
const DEFAULT_UNCONFIRMED_AFTER: PositiveMilliseconds = positiveMillisecondsSchema.parse(3_600_000);
const DEFAULT_USER_PAGE_LIMIT: PositiveInteger = positiveIntegerSchema.parse(1_000);
const DEFAULT_RATE_LIMIT_INTERVAL: PositiveMilliseconds = positiveMillisecondsSchema.parse(21);
const DEFAULT_DISPATCH_CONCURRENCY: PositiveInteger = positiveIntegerSchema.parse(8);
const DEFAULT_WORKER_POLL_INTERVAL: TimerDelayMs = timerDelayMsSchema.parse(100);
const DEFAULT_WORKER_ERROR_DELAY: TimerDelayMs = timerDelayMsSchema.parse(1_000);
const DEFAULT_COMPLETION_CHECK_INTERVAL: TimerDelayMs = timerDelayMsSchema.parse(1_000);

export const createEnvSchema = (defaultPort: Port): EnvSchema =>
  z
    .object({
      HOST: hostSchema.default(DEFAULT_HOST),
      PORT: portSchema.default(defaultPort),
      SHUTDOWN_DRAIN_MS: timerDelayOrZeroMsSchema.default(DEFAULT_DRAIN),
      SHUTDOWN_TIMEOUT_MS: timerDelayMsSchema.default(DEFAULT_TIMEOUT),
      LOG_LEVEL: logLevelSchema.default('log'),
      LOG_FORMAT: logFormatSchema.default('pretty'),
      DATABASE_URL: databaseUrlSchema,
      DATABASE_POOL_MAX: positiveIntegerSchema.default(DEFAULT_DATABASE_POOL_MAX),
      DATABASE_STATEMENT_TIMEOUT_MS: timerDelayMsSchema.default(DEFAULT_DATABASE_STATEMENT_TIMEOUT),
      DATABASE_LOCK_TIMEOUT_MS: timerDelayMsSchema.default(DEFAULT_DATABASE_LOCK_TIMEOUT),
      MOCK_API_URL: httpUrlSchema.default(DEFAULT_MOCK_API_URL),
      DISPATCH_MAX_REQUEST_MS: positiveMillisecondsSchema.default(DEFAULT_MAX_REQUEST),
      DISPATCH_LEASE_MS: positiveMillisecondsSchema.default(DEFAULT_LEASE),
      RECONCILE_DELAY_MS: positiveMillisecondsSchema.default(DEFAULT_RECONCILE_DELAY),
      RETRY_MAX_ATTEMPTS: positiveIntegerSchema.default(DEFAULT_RETRY_MAX_ATTEMPTS),
      RETRY_BASE_DELAY_MS: positiveMillisecondsSchema.default(DEFAULT_RETRY_BASE_DELAY),
      RETRY_MAX_DELAY_MS: positiveMillisecondsSchema.default(DEFAULT_RETRY_MAX_DELAY),
      LOOKUP_RETRY_BASE_DELAY_MS: positiveMillisecondsSchema.default(
        DEFAULT_LOOKUP_RETRY_BASE_DELAY,
      ),
      LOOKUP_RETRY_MAX_DELAY_MS: positiveMillisecondsSchema.default(DEFAULT_LOOKUP_RETRY_MAX_DELAY),
      UNCONFIRMED_AFTER_MS: positiveMillisecondsSchema.default(DEFAULT_UNCONFIRMED_AFTER),
      USER_PAGE_LIMIT: positiveIntegerSchema.default(DEFAULT_USER_PAGE_LIMIT),
      RATE_LIMIT_INTERVAL_MS: positiveMillisecondsSchema.default(DEFAULT_RATE_LIMIT_INTERVAL),
      DISPATCH_CONCURRENCY: positiveIntegerSchema.default(DEFAULT_DISPATCH_CONCURRENCY),
      WORKER_POLL_INTERVAL_MS: timerDelayMsSchema.default(DEFAULT_WORKER_POLL_INTERVAL),
      WORKER_ERROR_DELAY_MS: timerDelayMsSchema.default(DEFAULT_WORKER_ERROR_DELAY),
      COMPLETION_CHECK_INTERVAL_MS: timerDelayMsSchema.default(DEFAULT_COMPLETION_CHECK_INTERVAL),
    })
    .refine(
      ({ SHUTDOWN_DRAIN_MS, SHUTDOWN_TIMEOUT_MS }: Env): boolean =>
        timerDelayMsSchema.safeParse(SHUTDOWN_DRAIN_MS + SHUTDOWN_TIMEOUT_MS).success,
      {
        message: 'SHUTDOWN_DRAIN_MS + SHUTDOWN_TIMEOUT_MS must not exceed the Node timer maximum',
        path: ['SHUTDOWN_TIMEOUT_MS'],
      },
    );
