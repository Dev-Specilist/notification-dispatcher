import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckResult, HealthCheckService } from '@nestjs/terminus';
import { ReadinessHealthIndicator } from '@/modules/health/infrastructure/readiness.health-indicator';

@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly readiness: ReadinessHealthIndicator,
  ) {}

  @Get('livez')
  @HealthCheck()
  live(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  @Get('readyz')
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.health.check([() => this.readiness.check()]);
  }
}
