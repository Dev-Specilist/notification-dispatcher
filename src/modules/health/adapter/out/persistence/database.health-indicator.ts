import { setTimeout } from 'node:timers/promises';
import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { Pool, QueryConfig } from 'pg';

type DatabaseIndicatorKey = 'database';

type IndicatorSession = ReturnType<HealthIndicatorService['check']>;

interface PingSucceeded {
  readonly kind: 'reachable';
}

interface PingFailed {
  readonly kind: 'unreachable';
  readonly cause: string;
}

type Ping = PingSucceeded | PingFailed;

interface TimedQuery extends QueryConfig {
  readonly query_timeout: number;
}

@Injectable()
export class DatabaseHealthIndicator {
  private static readonly KEY: DatabaseIndicatorKey = 'database';

  private static readonly PING_TIMEOUT_MS: number = 1_000;

  private static readonly PING: TimedQuery = {
    text: 'SELECT 1',
    query_timeout: DatabaseHealthIndicator.PING_TIMEOUT_MS,
  };

  private readonly logger: Logger = new Logger('DatabaseHealth');

  constructor(
    private readonly indicator: HealthIndicatorService,
    private readonly pool: Pool,
  ) {}

  async check(): Promise<HealthIndicatorResult> {
    const session: IndicatorSession = this.indicator.check(DatabaseHealthIndicator.KEY);
    const ping: Ping = await Promise.race([this.ping(), DatabaseHealthIndicator.deadline()]);
    if (ping.kind === 'reachable') {
      return session.up();
    }
    this.logger.warn(`database is not ready: ${ping.cause}`);
    return session.down({ reason: 'database unreachable' });
  }

  private async ping(): Promise<Ping> {
    try {
      await this.pool.query(DatabaseHealthIndicator.PING);
      return { kind: 'reachable' };
    } catch (error) {
      return {
        kind: 'unreachable',
        cause: error instanceof Error ? error.message : 'non-error rejection',
      };
    }
  }

  private static deadline(): Promise<Ping> {
    return setTimeout<Ping>(
      DatabaseHealthIndicator.PING_TIMEOUT_MS,
      {
        kind: 'unreachable',
        cause: `no response within ${DatabaseHealthIndicator.PING_TIMEOUT_MS}ms`,
      },
      { ref: false },
    );
  }
}
