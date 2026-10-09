import { Module } from '@nestjs/common';
import { LifecycleModule } from '@/bootstrap/lifecycle/lifecycle.module';
import { HealthModule } from '@/modules/health/health.module';
import { NotificationWorkerModule } from '@/modules/notification/notification-worker.module';
import { createEnvSchema } from '@/shared/config/env.schema';
import { portSchema } from '@/shared/config/primitive.schema';
import { TypedConfigModule } from '@/shared/config/typed-config.module';
import { DatabaseModule } from '@/shared/database/database.module';
import { ApiStandardModule } from '@/shared/http/api-standard.module';
import { LoggingModule } from '@/shared/logging/logging.module';

@Module({
  imports: [
    TypedConfigModule.forRoot(createEnvSchema(portSchema.parse(3001))),
    LoggingModule.forRoot('worker'),
    DatabaseModule,
    ApiStandardModule,
    HealthModule,
    NotificationWorkerModule,
    LifecycleModule,
  ],
})
export class WorkerModule {}
