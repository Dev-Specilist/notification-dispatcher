import { Module } from '@nestjs/common';
import { LifecycleModule } from '@/bootstrap/lifecycle/lifecycle.module';
import { HealthModule } from '@/modules/health/health.module';
import { createEnvSchema } from '@/shared/config/env.schema';
import { portSchema } from '@/shared/config/primitive.schema';
import { TypedConfigModule } from '@/shared/config/typed-config.module';
import { LoggingModule } from '@/shared/logging/logging.module';

@Module({
  imports: [
    TypedConfigModule.forRoot(createEnvSchema(portSchema.parse(3000))),
    LoggingModule.forRoot('api'),
    HealthModule,
    LifecycleModule,
  ],
})
export class ApiModule {}
