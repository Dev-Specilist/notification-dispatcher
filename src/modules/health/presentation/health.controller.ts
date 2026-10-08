import { Controller, Get, UseFilters } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { DatabaseHealthIndicator } from '@/modules/health/infrastructure/database.health-indicator';
import { ReadinessHealthIndicator } from '@/modules/health/infrastructure/readiness.health-indicator';
import { HealthCheckFilter } from '@/modules/health/presentation/health-check.filter';

@Controller()
@UseFilters(HealthCheckFilter)
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly readiness: ReadinessHealthIndicator,
    private readonly database: DatabaseHealthIndicator,
  ) {}

  @Get('livez')
  @HealthCheck()
  live(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  @Get('readyz')
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.health.check([
      (): HealthIndicatorResult => this.readiness.check(),
      (): Promise<HealthIndicatorResult> => this.database.check(),
    ]);
  }
}
