import { Test, TestingModule } from '@nestjs/testing';
import { Pool, QueryResult } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEnvSchema } from '@/shared/config/env.schema';
import { portSchema } from '@/shared/config/primitive.schema';
import { TypedConfigModule } from '@/shared/config/typed-config.module';
import { DatabaseMigrator } from '@/shared/database/database-migrator.service';
import { DatabaseModule } from '@/shared/database/database.module';
import { TestDatabase } from '@/shared/database/testing/test-database.helper';

interface TableRow {
  readonly table_name: string;
}

const NOTIFICATION_TABLES: ReadonlyArray<string> = [
  'alarms',
  'deliveries',
  'expansion_jobs',
  'rate_limiters',
];

const migrateOnce = async (): Promise<Pool> => {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [TypedConfigModule.forRoot(createEnvSchema(portSchema.parse(3000))), DatabaseModule],
    providers: [DatabaseMigrator],
  }).compile();
  try {
    await moduleRef.get(DatabaseMigrator).migrate();
    return moduleRef.get(Pool);
  } finally {
    await moduleRef.close();
  }
};

describe('DatabaseMigrator', () => {
  let emptyDatabase: TestDatabase;

  const publicTables = async (): Promise<ReadonlyArray<string>> => {
    const result: QueryResult<TableRow> = await emptyDatabase.pool.query<TableRow>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    return result.rows.map(({ table_name }: TableRow): string => table_name);
  };

  beforeEach(async (): Promise<void> => {
    emptyDatabase = await TestDatabase.createEmpty();
    vi.stubEnv('DATABASE_URL', emptyDatabase.databaseUrl);
  });

  afterEach(async (): Promise<void> => {
    vi.unstubAllEnvs();
    await emptyDatabase.drop();
  });

  it('빈 DB에 migration을 적용하면 알림 테이블이 모두 생기고, 끝나면 Pool을 닫는다', async (): Promise<void> => {
    expect(await publicTables()).toEqual([]);

    const pool: Pool = await migrateOnce();

    expect(await publicTables()).toEqual(NOTIFICATION_TABLES);
    expect(pool.ended).toBe(true);
  });

  it('이미 적용된 DB에 다시 실행해도 실패하지 않고 테이블이 그대로다', async (): Promise<void> => {
    await migrateOnce();
    expect(await publicTables()).toEqual(NOTIFICATION_TABLES);

    await expect(migrateOnce()).resolves.toBeInstanceOf(Pool);
    expect(await publicTables()).toEqual(NOTIFICATION_TABLES);
  });
});
