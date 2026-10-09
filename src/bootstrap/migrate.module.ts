import { DynamicModule, Module } from '@nestjs/common';
import { createEnvSchema } from '@/shared/config/env.schema';
import { portSchema } from '@/shared/config/primitive.schema';
import { TypedConfigModule } from '@/shared/config/typed-config.module';
import { DatabaseMigrator } from '@/shared/database/database-migrator.service';
import { DatabaseModule } from '@/shared/database/database.module';
import { LoggingModule } from '@/shared/logging/logging.module';

@Module({})
export class MigrateModule {
  static forRoot(): DynamicModule {
    return {
      module: MigrateModule,
      imports: [
        TypedConfigModule.forRoot(createEnvSchema(portSchema.parse(3002))),
        LoggingModule.forRoot('migrate'),
        DatabaseModule,
      ],
      providers: [DatabaseMigrator],
    };
  }
}
