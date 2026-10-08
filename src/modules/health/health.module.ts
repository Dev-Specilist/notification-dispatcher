import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { ReadinessPort } from '@/modules/health/application/port/out/readiness.port';
import { InMemoryReadinessAdapter } from '@/modules/health/adapter/out/in-memory/in-memory-readiness.adapter';
import { DatabaseHealthIndicator } from '@/modules/health/adapter/out/persistence/database.health-indicator';
import { ReadinessHealthIndicator } from '@/modules/health/adapter/in/web/readiness.health-indicator';
import { HealthController } from '@/modules/health/adapter/in/web/health.controller';

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
