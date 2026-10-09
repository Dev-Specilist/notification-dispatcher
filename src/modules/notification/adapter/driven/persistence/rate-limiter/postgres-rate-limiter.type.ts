import { SQL } from 'drizzle-orm';
import { DurationMs } from '@/shared/domain/duration.type';

export interface DatabaseClock {
  now(): SQL;
}

export interface RateLimiterSettings {
  readonly name: string;
  readonly emissionIntervalMs: DurationMs;
}
