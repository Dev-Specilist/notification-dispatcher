import { Module } from '@nestjs/common';
import { ShutdownService } from '@/bootstrap/lifecycle/shutdown.service';
import { HealthModule } from '@/modules/health/health.module';

@Module({
  imports: [HealthModule],
  providers: [ShutdownService],
})
export class LifecycleModule {}
