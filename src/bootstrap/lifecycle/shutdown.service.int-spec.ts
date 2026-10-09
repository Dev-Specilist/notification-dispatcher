import { scheduler } from 'node:timers/promises';
import { BeforeApplicationShutdown, ConsoleLogger, Injectable } from '@nestjs/common';
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
import { ApiModule } from '@/bootstrap/api.module';
import { ShutdownService } from '@/bootstrap/lifecycle/shutdown.service';
import { TestDatabase } from '@/shared/database/testing/test-database.helper';

interface ProbeRow {
  readonly answer: number;
}

type ExitSpy = MockInstance<typeof process.exit>;

type ErrorLogSpy = MockInstance<ConsoleLogger['error']>;

type ErrorLogCall = Parameters<ConsoleLogger['error']>;

class ExitCalled extends Error {}

const DRAIN_MS: number = 30;

const TIMEOUT_MS: number = 200;

@Injectable()
class DrainingWork implements BeforeApplicationShutdown {
  answerDuringDrain: number = 0;

  constructor(private readonly pool: Pool) {}

  async beforeApplicationShutdown(): Promise<void> {
    const result: QueryResult<ProbeRow> = await this.pool.query<ProbeRow>('SELECT 42 AS answer');
    const [{ answer }]: ReadonlyArray<ProbeRow> = result.rows;
    this.answerDuringDrain = answer;
  }
}

const yieldUntil = async (condition: () => boolean): Promise<void> => {
  while (!condition()) {
    await scheduler.yield();
  }
};

describe('ShutdownService', () => {
  let testDatabase: TestDatabase;
  let moduleRef: TestingModule;
  let closed: boolean;

  beforeAll(async (): Promise<void> => {
    testDatabase = await TestDatabase.create();
    vi.stubEnv('DATABASE_URL', testDatabase.databaseUrl);
    vi.stubEnv('SHUTDOWN_DRAIN_MS', String(DRAIN_MS));
    vi.stubEnv('SHUTDOWN_TIMEOUT_MS', String(TIMEOUT_MS));
  });

  afterAll(async (): Promise<void> => {
    vi.unstubAllEnvs();
    await testDatabase.drop();
  });

  beforeEach(async (): Promise<void> => {
    closed = false;
    moduleRef = await Test.createTestingModule({
      imports: [ApiModule.forRoot()],
      providers: [DrainingWork],
    }).compile();
  });

  afterEach(async (): Promise<void> => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (!closed) {
      await moduleRef.close();
    }
  });

  it('실제 api 루트 모듈을 닫으면 drain 단계 작업은 DB를 쓸 수 있고, Pool은 그 뒤에 닫힌다', async (): Promise<void> => {
    const pool: Pool = moduleRef.get(Pool);
    const work: DrainingWork = moduleRef.get(DrainingWork);

    closed = true;
    await moduleRef.close();

    expect(work.answerDuringDrain).toBe(42);
    expect(pool.ended).toBe(true);
  });

  it('실제 api 루트 모듈에서 반납되지 않은 연결 때문에 Pool 종료가 끝나지 않으면 기한이 지나 exit(1)로 강제 종료한다', async (): Promise<void> => {
    const errorLog: ErrorLogSpy = vi
      .spyOn(ConsoleLogger.prototype, 'error')
      .mockImplementation((): void => {});
    const pool: Pool = moduleRef.get(Pool);
    const held: PoolClient = await pool.connect();
    const exit: ExitSpy = vi.spyOn(process, 'exit').mockImplementation((): never => {
      throw new ExitCalled();
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const shutdown: ShutdownService = moduleRef.get(ShutdownService);
    const drainStarted: MockInstance<ShutdownService['beforeApplicationShutdown']> = vi.spyOn(
      shutdown,
      'beforeApplicationShutdown',
    );
    shutdown.handleSignal('SIGTERM');

    closed = true;
    const closing: Promise<void> = moduleRef.close();
    await yieldUntil((): boolean => drainStarted.mock.calls.length > 0);
    await vi.advanceTimersByTimeAsync(DRAIN_MS);
    await yieldUntil((): boolean => pool.ending);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(exit).not.toHaveBeenCalled();

    await expect(vi.advanceTimersByTimeAsync(1)).rejects.toThrow(ExitCalled);
    expect(exit).toHaveBeenCalledWith(1);
    expect(errorLog.mock.calls.map(([message]: ErrorLogCall): string => String(message))).toEqual([
      `shutdown did not finish within ${DRAIN_MS + TIMEOUT_MS}ms, forcing exit`,
    ]);

    vi.useRealTimers();
    held.release();
    await closing;
  });
});
