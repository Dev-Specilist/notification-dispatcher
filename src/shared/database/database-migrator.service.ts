import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool, PoolClient } from 'pg';

@Injectable()
export class DatabaseMigrator {
  private static readonly MIGRATIONS_FOLDER: string = 'drizzle';

  private readonly logger: Logger = new Logger(DatabaseMigrator.name);

  constructor(private readonly pool: Pool) {}

  async migrate(): Promise<void> {
    const migrationsFolder: string = join(process.cwd(), DatabaseMigrator.MIGRATIONS_FOLDER);
    const migrationClient: PoolClient = await this.pool.connect();
    try {
      await migrationClient.query('SET statement_timeout = 0');
      await migrate(drizzle({ client: migrationClient }), { migrationsFolder });
    } finally {
      migrationClient.release(true);
    }
    this.logger.log(`migrations in ${migrationsFolder} are applied`);
  }
}
