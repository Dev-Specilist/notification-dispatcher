import { z } from 'zod';
import { EnvSchema } from '@/shared/config/env.type';
import {
  databaseUrlSchema,
  Host,
  hostSchema,
  Milliseconds,
  millisecondsSchema,
  Port,
  portSchema,
  positiveMillisecondsSchema,
} from '@/shared/config/primitive.schema';
import { logFormatSchema, logLevelSchema } from '@/shared/logging/logging.schema';

const DEFAULT_HOST: Host = hostSchema.parse('0.0.0.0');
const DEFAULT_DRAIN: Milliseconds = millisecondsSchema.parse(5000);
const DEFAULT_TIMEOUT: Milliseconds = positiveMillisecondsSchema.parse(25000);

export const createEnvSchema = (defaultPort: Port): EnvSchema =>
  z.object({
    HOST: hostSchema.default(DEFAULT_HOST),
    PORT: portSchema.default(defaultPort),
    SHUTDOWN_DRAIN_MS: millisecondsSchema.default(DEFAULT_DRAIN),
    SHUTDOWN_TIMEOUT_MS: positiveMillisecondsSchema.default(DEFAULT_TIMEOUT),
    LOG_LEVEL: logLevelSchema.default('log'),
    LOG_FORMAT: logFormatSchema.default('pretty'),
    DATABASE_URL: databaseUrlSchema,
  });
