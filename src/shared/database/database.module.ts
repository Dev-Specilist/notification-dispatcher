import { Global, Logger, Module } from '@nestjs/common';
import { Pool } from 'pg';
import { TypedConfigService } from '@/shared/config/typed-config.service';
import { DatabaseShutdown } from '@/shared/database/database-shutdown.service';

@Global()
@Module({
  providers: [
    {
      provide: Pool,
      inject: [TypedConfigService],
      useFactory: (config: TypedConfigService): Pool => DatabaseModule.createPool(config),
    },
    DatabaseShutdown,
  ],
  exports: [Pool, DatabaseShutdown],
})
export class DatabaseModule {
  private static readonly CONNECTION_TIMEOUT_MS: number = 5_000;

  private static readonly logger: Logger = new Logger(DatabaseModule.name);

  private static createPool(config: TypedConfigService): Pool {
    const pool: Pool = new Pool({
      connectionString: config.get('DATABASE_URL'),
      max: config.get('DATABASE_POOL_MAX'),
      connectionTimeoutMillis: DatabaseModule.CONNECTION_TIMEOUT_MS,
    });
    pool.on('error', (error: Error): void => {
      DatabaseModule.logger.error(`idle database connection failed: ${error.message}`);
    });
    return pool;
  }
}
