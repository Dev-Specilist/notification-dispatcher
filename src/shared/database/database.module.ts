import { Global, Logger, Module, OnModuleInit } from '@nestjs/common';
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
export class DatabaseModule implements OnModuleInit {
  private static readonly CONNECTION_TIMEOUT_MS: number = 5_000;

  private static readonly logger: Logger = new Logger(DatabaseModule.name);

  constructor(private readonly pool: Pool) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.pool.query('SELECT 1');
    } catch (reason) {
      const message: string = reason instanceof Error ? reason.message : String(reason);
      throw new Error(`database is unreachable at startup: ${message}`, { cause: reason });
    }
  }

  private static createPool(config: TypedConfigService): Pool {
    const pool: Pool = new Pool({
      connectionString: config.get('DATABASE_URL'),
      max: config.get('DATABASE_POOL_MAX'),
      connectionTimeoutMillis: DatabaseModule.CONNECTION_TIMEOUT_MS,
      statement_timeout: config.get('DATABASE_STATEMENT_TIMEOUT_MS'),
      lock_timeout: config.get('DATABASE_LOCK_TIMEOUT_MS'),
    });
    pool.on('error', (error: Error): void => {
      DatabaseModule.logger.error(`idle database connection failed: ${error.message}`);
    });
    return pool;
  }
}
