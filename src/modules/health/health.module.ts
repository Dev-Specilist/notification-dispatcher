import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { ReadinessPort } from '@/modules/health/application/port/readiness.port';
import { InMemoryReadinessAdapter } from '@/modules/health/infrastructure/adapter/in-memory-readiness.adapter';
import { DatabaseHealthIndicator } from '@/modules/health/infrastructure/database.health-indicator';
import { ReadinessHealthIndicator } from '@/modules/health/infrastructure/readiness.health-indicator';
import { HealthController } from '@/modules/health/presentation/health.controller';

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
