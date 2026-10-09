import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

@Injectable()
export class DatabaseMigrator {
  private static readonly MIGRATIONS_FOLDER: string = 'drizzle';

  private readonly logger: Logger = new Logger('Migration');

  constructor(private readonly pool: Pool) {}

  async migrate(): Promise<void> {
    const migrationsFolder: string = join(process.cwd(), DatabaseMigrator.MIGRATIONS_FOLDER);
    await migrate(drizzle({ client: this.pool }), { migrationsFolder });
    this.logger.log(`migrations in ${migrationsFolder} are applied`);
  }
}
