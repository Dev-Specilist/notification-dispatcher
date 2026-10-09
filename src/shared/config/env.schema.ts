import { z } from 'zod';
import { Env, EnvSchema } from '@/shared/config/env.type';
import {
  databaseUrlSchema,
  Host,
  hostSchema,
  httpUrlSchema,
  Milliseconds,
  Port,
  portSchema,
  positiveIntegerSchema,
  positiveMillisecondsSchema,
  timerDelayMsSchema,
  timerDelayOrZeroMsSchema,
} from '@/shared/config/primitive.schema';
import { HttpUrl, PositiveInteger, TimerDelayMs } from '@/shared/config/primitive.type';
import { logFormatSchema, logLevelSchema } from '@/shared/logging/logging.schema';

const DEFAULT_HOST: Host = hostSchema.parse('0.0.0.0');
const DEFAULT_DRAIN: Milliseconds = timerDelayOrZeroMsSchema.parse(5000);
const DEFAULT_TIMEOUT: TimerDelayMs = timerDelayMsSchema.parse(25000);
const DEFAULT_MOCK_API_URL: HttpUrl = httpUrlSchema.parse('http://localhost:4000');
const DEFAULT_MAX_REQUEST: Milliseconds = positiveMillisecondsSchema.parse(5000);
const DEFAULT_LEASE: Milliseconds = positiveMillisecondsSchema.parse(30000);
const DEFAULT_RECONCILE_DELAY: Milliseconds = positiveMillisecondsSchema.parse(35000);
const DEFAULT_RETRY_MAX_ATTEMPTS: PositiveInteger = positiveIntegerSchema.parse(5);
const DEFAULT_RETRY_BASE_DELAY: Milliseconds = positiveMillisecondsSchema.parse(1000);
const DEFAULT_RETRY_MAX_DELAY: Milliseconds = positiveMillisecondsSchema.parse(60000);
const DEFAULT_LOOKUP_RETRY_MAX_ATTEMPTS: PositiveInteger = positiveIntegerSchema.parse(10);
const DEFAULT_LOOKUP_RETRY_BASE_DELAY: Milliseconds = positiveMillisecondsSchema.parse(5000);
const DEFAULT_LOOKUP_RETRY_MAX_DELAY: Milliseconds = positiveMillisecondsSchema.parse(60000);
const DEFAULT_UNCONFIRMED_AFTER: Milliseconds = positiveMillisecondsSchema.parse(3600000);
const DEFAULT_USER_PAGE_LIMIT: PositiveInteger = positiveIntegerSchema.parse(1000);
const DEFAULT_RATE_LIMIT_INTERVAL: Milliseconds = positiveMillisecondsSchema.parse(20);
const DEFAULT_DISPATCH_CONCURRENCY: PositiveInteger = positiveIntegerSchema.parse(8);
const DEFAULT_WORKER_POLL_INTERVAL: TimerDelayMs = timerDelayMsSchema.parse(100);
const DEFAULT_WORKER_ERROR_DELAY: TimerDelayMs = timerDelayMsSchema.parse(1000);
const DEFAULT_COMPLETION_CHECK_INTERVAL: TimerDelayMs = timerDelayMsSchema.parse(1000);

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
      MOCK_API_URL: httpUrlSchema.default(DEFAULT_MOCK_API_URL),
      DISPATCH_MAX_REQUEST_MS: positiveMillisecondsSchema.default(DEFAULT_MAX_REQUEST),
      DISPATCH_LEASE_MS: positiveMillisecondsSchema.default(DEFAULT_LEASE),
      RECONCILE_DELAY_MS: positiveMillisecondsSchema.default(DEFAULT_RECONCILE_DELAY),
      RETRY_MAX_ATTEMPTS: positiveIntegerSchema.default(DEFAULT_RETRY_MAX_ATTEMPTS),
      RETRY_BASE_DELAY_MS: positiveMillisecondsSchema.default(DEFAULT_RETRY_BASE_DELAY),
      RETRY_MAX_DELAY_MS: positiveMillisecondsSchema.default(DEFAULT_RETRY_MAX_DELAY),
      LOOKUP_RETRY_MAX_ATTEMPTS: positiveIntegerSchema.default(DEFAULT_LOOKUP_RETRY_MAX_ATTEMPTS),
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
