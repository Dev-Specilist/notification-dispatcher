import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { ReadinessPort } from '@/modules/health/application/port/driven/for-tracking-readiness/readiness.port';
import { InMemoryReadinessAdapter } from '@/modules/health/adapter/driven/process-state/in-memory-readiness.adapter';
import { DatabaseHealthIndicator } from '@/modules/health/adapter/driven/persistence/database.health-indicator';
import { ReadinessHealthIndicator } from '@/modules/health/adapter/driving/web/readiness.health-indicator';
import { HealthController } from '@/modules/health/adapter/driving/web/health.controller';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [
    { provide: ReadinessPort, useClass: InMemoryReadinessAdapter },
    ReadinessHealthIndicator,
    DatabaseHealthIndicator,
  ],
  exports: [ReadinessPort],
})
export class HealthModule {}
