import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import type { TestProject } from 'vitest/node';
import { TestDatabase } from '@/shared/database/testing/test-database.helper';

declare module 'vitest' {
  export interface ProvidedContext {
    readonly postgresAdminUri: string;
  }
}

const POSTGRES_IMAGE: string = 'postgres:18-alpine';

const containers: Array<StartedPostgreSqlContainer> = [];

const prepareTemplate = async (adminUri: string): Promise<void> => {
  await TestDatabase.runAsAdmin(adminUri, `CREATE DATABASE "${TestDatabase.TEMPLATE_NAME}"`);
  const pool: Pool = new Pool({
    connectionString: TestDatabase.uriFor(adminUri, TestDatabase.TEMPLATE_NAME),
  });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: './drizzle' });
  } finally {
    await pool.end();
  }
};

export const setup = async (project: TestProject): Promise<void> => {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    POSTGRES_IMAGE,
  ).start();
  containers.push(container);
  await prepareTemplate(container.getConnectionUri());
  project.provide('postgresAdminUri', container.getConnectionUri());
};

export const teardown = async (): Promise<void> => {
  await Promise.all(
    containers.map(async (container: StartedPostgreSqlContainer): Promise<void> => {
      await container.stop();
    }),
  );
};
