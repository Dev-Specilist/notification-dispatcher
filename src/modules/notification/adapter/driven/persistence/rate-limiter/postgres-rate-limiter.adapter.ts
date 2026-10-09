import { SQL, sql } from 'drizzle-orm';
import { SendPermitPort } from '@/modules/notification/application/port/driven/for-permitting-sends/send-permit.port';
import { SendPermit } from '@/modules/notification/application/port/driven/for-permitting-sends/send-permit.type';
import {
  DatabaseClock,
  RateLimiterSettings,
} from '@/modules/notification/adapter/driven/persistence/rate-limiter/postgres-rate-limiter.type';
import { NotificationDatabase } from '@/modules/notification/adapter/driven/persistence/notification-database.type';
import { rateLimiters } from '@/modules/notification/adapter/driven/persistence/rate-limiter/rate-limiter.table';
import { RetryAfterMs } from '@/modules/notification/domain/delivery/delivery.type';
import { DurationMs } from '@/shared/domain/duration.type';

interface GrantedRow {
  readonly name: string;
}

export class PostgresRateLimiterAdapter implements SendPermitPort {
  static readonly SERVER_CLOCK: DatabaseClock = { now: (): SQL => sql`clock_timestamp()` };

  private static readonly NEVER: SQL = sql`'-infinity'::timestamptz`;

  constructor(
    private readonly database: NotificationDatabase,
    private readonly settings: Readonly<RateLimiterSettings>,
    private readonly clock: DatabaseClock,
  ) {}

  async acquire(): Promise<SendPermit> {
    const nextArrival: SQL = this.after(this.settings.emissionIntervalMs);
    const granted: ReadonlyArray<GrantedRow> = await this.database
      .insert(rateLimiters)
      .values({
        name: this.settings.name,
        theoreticalArrivalAt: nextArrival,
        heldUntil: PostgresRateLimiterAdapter.NEVER,
      })
      .onConflictDoUpdate({
        target: rateLimiters.name,
        set: { theoreticalArrivalAt: nextArrival },
        setWhere: sql`${rateLimiters.theoreticalArrivalAt} <= ${this.clock.now()} AND ${rateLimiters.heldUntil} <= ${this.clock.now()}`,
      })
      .returning({ name: rateLimiters.name });
    return granted.length === 0 ? { kind: 'denied' } : { kind: 'granted' };
  }

  async holdFor(retryAfterMs: RetryAfterMs): Promise<void> {
    const heldUntil: SQL = this.after(retryAfterMs);
    await this.database
      .insert(rateLimiters)
      .values({
        name: this.settings.name,
        theoreticalArrivalAt: PostgresRateLimiterAdapter.NEVER,
        heldUntil,
      })
      .onConflictDoUpdate({
        target: rateLimiters.name,
        set: { heldUntil: sql`greatest(${rateLimiters.heldUntil}, ${heldUntil})` },
      });
  }

  private after(milliseconds: DurationMs | RetryAfterMs): SQL {
    return sql`${this.clock.now()} + ${milliseconds}::bigint * interval '1 millisecond'`;
  }
}
