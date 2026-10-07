import { Injectable } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { ReadinessPort } from '@/modules/health/application/port/readiness.port';

type ReadinessIndicatorKey = 'lifecycle';

type IndicatorSession = ReturnType<HealthIndicatorService['check']>;

@Injectable()
export class ReadinessHealthIndicator {
  private static readonly KEY: ReadinessIndicatorKey = 'lifecycle';

  constructor(
    private readonly indicator: HealthIndicatorService,
    private readonly readiness: ReadinessPort,
  ) {}

  check(): HealthIndicatorResult {
    const session: IndicatorSession = this.indicator.check(ReadinessHealthIndicator.KEY);
    if (this.readiness.isAcceptingTraffic()) {
      return session.up();
    }
    return session.down({ reason: 'shutting down' });
  }
}
