import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Pool, PoolClient, QueryResult } from 'pg';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  MockInstance,
  vi,
} from 'vitest';
import { createEnvSchema } from '@/shared/config/env.schema';
import { portSchema } from '@/shared/config/primitive.schema';
import { TypedConfigModule } from '@/shared/config/typed-config.module';
import { DatabaseModule } from '@/shared/database/database.module';
import { TestDatabase } from '@/shared/database/testing/test-database';

interface ProbeRow {
  readonly answer: number;
}

interface BackendRow {
  readonly pid: number;
}

describe('DatabaseModule', () => {
  let testDatabase: TestDatabase;
  let moduleRef: TestingModule;
  let pool: Pool;

  beforeAll(async (): Promise<void> => {
    testDatabase = await TestDatabase.create();
  });

  afterAll(async (): Promise<void> => {
    await testDatabase.drop();
  });

  beforeEach(async (): Promise<void> => {
    vi.stubEnv('DATABASE_URL', testDatabase.databaseUrl);
    moduleRef = await Test.createTestingModule({
      imports: [TypedConfigModule.forRoot(createEnvSchema(portSchema.parse(3000))), DatabaseModule],
    }).compile();
    pool = moduleRef.get(Pool);
  });

  afterEach(async (): Promise<void> => {
    await moduleRef.close();
    await pool.end();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('DATABASE_URL로 만든 Pool로 쿼리할 수 있다', async (): Promise<void> => {
    const result: QueryResult<ProbeRow> = await pool.query<ProbeRow>('SELECT 1 AS answer');

    expect(result.rows).toEqual([{ answer: 1 }]);
  });

  it('유휴 연결이 DB 쪽에서 끊겨도 프로세스를 죽이지 않고 오류를 로그로 남긴다', async (): Promise<void> => {
    const logged: MockInstance<Logger['error']> = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((): void => {});
    const client: PoolClient = await pool.connect();
    const result: QueryResult<BackendRow> = await client.query<BackendRow>(
      'SELECT pg_backend_pid() AS pid',
    );
    const [{ pid }]: ReadonlyArray<BackendRow> = result.rows;
    client.release();

    await testDatabase.pool.query('SELECT pg_terminate_backend($1)', [pid]);

    await vi.waitFor((): void => {
      expect(logged).toHaveBeenCalled();
    });
  });
});
