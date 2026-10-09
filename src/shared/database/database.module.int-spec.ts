import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
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
import { TestDatabase } from '@/shared/database/testing/test-database.helper';

interface ProbeRow {
  readonly answer: number;
}

interface BackendRow {
  readonly pid: number;
}

interface LockProbeRow {
  readonly id: number;
}

interface PostgresErrorCause {
  readonly code: string;
}

interface DrizzleErrorShape {
  readonly cause: PostgresErrorCause;
}

const QUERY_CANCELED: PostgresErrorCause = { code: '57014' };

const LOCK_NOT_AVAILABLE: DrizzleErrorShape = { cause: { code: '55P03' } };

const UNREACHABLE_DATABASE_URL: string = 'postgres://app:secret@127.0.0.1:1/notification';

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
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('DATABASE_URL로 만든 Pool로 쿼리할 수 있다', async (): Promise<void> => {
    const result: QueryResult<ProbeRow> = await pool.query<ProbeRow>('SELECT 1 AS answer');

    expect(result.rows).toEqual([{ answer: 1 }]);
  });

  it('DB-22 DB에 연결할 수 있다 / 모듈을 초기화한다 → 연결 확인을 통과해 기동을 이어간다', async (): Promise<void> => {
    await expect(moduleRef.init()).resolves.toBe(moduleRef);
  });

  it('DB-22 DB에 연결할 수 없다 / 모듈을 초기화한다 → 초기화 단계에서 원인을 담은 오류로 기동을 멈춘다', async (): Promise<void> => {
    vi.stubEnv('DATABASE_URL', UNREACHABLE_DATABASE_URL);
    const unreachableModuleRef: TestingModule = await Test.createTestingModule({
      imports: [TypedConfigModule.forRoot(createEnvSchema(portSchema.parse(3000))), DatabaseModule],
    }).compile();

    await expect(unreachableModuleRef.init()).rejects.toThrow(
      /database is unreachable at startup: .+/,
    );
    await unreachableModuleRef.get(Pool).end();
  });

  const recreateModule = async (): Promise<void> => {
    await moduleRef.close();
    moduleRef = await Test.createTestingModule({
      imports: [TypedConfigModule.forRoot(createEnvSchema(portSchema.parse(3000))), DatabaseModule],
    }).compile();
    pool = moduleRef.get(Pool);
  };

  it('DB-23 문장 시간 제한을 둔 Pool / 제한보다 오래 걸리는 쿼리를 실행한다 → 제한 시간에 취소되고 Pool은 계속 쓸 수 있다', async (): Promise<void> => {
    vi.stubEnv('DATABASE_STATEMENT_TIMEOUT_MS', '200');
    await recreateModule();

    await expect(pool.query('SELECT pg_sleep(5)')).rejects.toMatchObject(QUERY_CANCELED);

    const result: QueryResult<ProbeRow> = await pool.query<ProbeRow>('SELECT 1 AS answer');
    expect(result.rows).toEqual([{ answer: 1 }]);
  });

  it('DB-24 다른 트랜잭션이 행을 잠갔다 / FOR UPDATE로 같은 행을 잠그려 한다 → 잠금 대기 제한 안에 실패하고 트랜잭션은 롤백되며 연결은 Pool로 돌아온다', async (): Promise<void> => {
    vi.stubEnv('DATABASE_LOCK_TIMEOUT_MS', '200');
    await recreateModule();
    await testDatabase.pool.query('CREATE TABLE lock_probes (id integer PRIMARY KEY)');
    await testDatabase.pool.query('INSERT INTO lock_probes (id) VALUES (1)');
    const lockHolder: PoolClient = await testDatabase.pool.connect();
    await lockHolder.query('BEGIN');
    await lockHolder.query('SELECT id FROM lock_probes WHERE id = 1 FOR UPDATE');
    const database: NodePgDatabase = drizzle({ client: pool });
    const startedAt: number = Date.now();

    try {
      await expect(
        database.transaction(async (transaction: NodePgDatabase): Promise<void> => {
          await transaction.execute(sql`INSERT INTO lock_probes (id) VALUES (2)`);
          await transaction.execute(sql`SELECT id FROM lock_probes WHERE id = 1 FOR UPDATE`);
        }),
      ).rejects.toMatchObject(LOCK_NOT_AVAILABLE);
      expect(Date.now() - startedAt).toBeLessThan(2_000);
    } finally {
      await lockHolder.query('ROLLBACK');
      lockHolder.release();
    }

    const remainingProbes: QueryResult<LockProbeRow> = await pool.query<LockProbeRow>(
      'SELECT id FROM lock_probes ORDER BY id',
    );
    expect(remainingProbes.rows).toEqual([{ id: 1 }]);
    expect(pool.idleCount).toBe(pool.totalCount);
  });

  it('종료 단계에서 DB Pool을 닫는다', async (): Promise<void> => {
    await moduleRef.close();

    expect(pool.ended).toBe(true);
  });

  it('DATABASE_POOL_MAX만큼만 연결을 열고 그 이상의 요청은 연결이 반환될 때까지 기다리게 한다', async (): Promise<void> => {
    await moduleRef.close();
    vi.stubEnv('DATABASE_POOL_MAX', '2');
    moduleRef = await Test.createTestingModule({
      imports: [TypedConfigModule.forRoot(createEnvSchema(portSchema.parse(3000))), DatabaseModule],
    }).compile();
    pool = moduleRef.get(Pool);
    const heldClients: ReadonlyArray<PoolClient> = await Promise.all([
      pool.connect(),
      pool.connect(),
    ]);

    const waitingClient: Promise<PoolClient> = pool.connect();

    expect(pool.totalCount).toBe(2);
    expect(pool.waitingCount).toBe(1);
    heldClients.forEach((heldClient: PoolClient): void => heldClient.release());
    (await waitingClient).release();
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
