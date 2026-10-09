import { randomUUID } from 'node:crypto';
import { Pool, QueryResult } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExpansionJobRepositoryContract } from '@/modules/notification/testing/contract/expansion-job-repository.contract';
import { DrizzleAlarmRepositoryAdapter } from '@/modules/notification/adapter/driven/persistence/alarm/drizzle-alarm-repository.adapter';
import { DrizzleExpansionJobRepositoryAdapter } from '@/modules/notification/adapter/driven/persistence/expansion-job/drizzle-expansion-job-repository.adapter';
import { DrizzleTransactionAdapter } from '@/modules/notification/adapter/driven/persistence/drizzle-transaction.adapter';
import { TransactionRepositories } from '@/modules/notification/application/port/driven/for-running-transactions/transaction.type';
import { NotificationDatabaseFactory } from '@/modules/notification/adapter/driven/persistence/notification-database.factory';
import { NotificationDatabase } from '@/modules/notification/adapter/driven/persistence/notification-database.type';
import { TestDatabase } from '@/shared/database/testing/test-database';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { ExpansionClaim } from '@/modules/notification/application/port/driven/for-storing-expansion-jobs/expansion-job-repository.type';

interface DrizzleRepositories {
  readonly alarmRepository: DrizzleAlarmRepositoryAdapter;
  readonly expansionJobRepository: DrizzleExpansionJobRepositoryAdapter;
}

interface CursorColumns {
  readonly cursor_kind: string;
  readonly cursor_token: string;
}

type InvalidStateCase = Readonly<[string, string]>;

interface Gate {
  readonly opened: Promise<void>;
  readonly open: () => void;
}

const NOT_YET_OPENED: () => void = (): void => {};

const createGate = (): Gate => {
  let release: () => void = NOT_YET_OPENED;
  const opened: Promise<void> = new Promise<void>((resolve: () => void): void => {
    release = resolve;
  });
  return { opened, open: (): void => release() };
};

describe('DrizzleExpansionJobRepositoryAdapter', () => {
  let testDatabase: TestDatabase;

  beforeAll(async (): Promise<void> => {
    testDatabase = await TestDatabase.create();
  });

  afterAll(async (): Promise<void> => {
    await testDatabase.drop();
  });

  ExpansionJobRepositoryContract.verify(async (): Promise<DrizzleRepositories> => {
    await testDatabase.pool.query('TRUNCATE alarms CASCADE');
    const database: NotificationDatabase = NotificationDatabaseFactory.create(testDatabase.pool);
    return {
      alarmRepository: new DrizzleAlarmRepositoryAdapter(database),
      expansionJobRepository: new DrizzleExpansionJobRepositoryAdapter(database),
    };
  });

  const storedAlarmId = async (): Promise<string> => {
    const alarmId: string = randomUUID();
    await testDatabase.pool.query(
      `INSERT INTO alarms (id, title, body, kind, recipient_ids, status, created_at) VALUES ($1, 't', 'b', 'BULK', '{}', 'DRAFT', now())`,
      [alarmId],
    );
    return alarmId;
  };

  it('DB-18 두 워커가 동시에 확장 작업을 claim하면 FOR UPDATE SKIP LOCKED로 서로 다른 작업을 가져간다', async (): Promise<void> => {
    await testDatabase.pool.query('TRUNCATE alarms CASCADE');
    const enqueuedAlarmIds: ReadonlyArray<string> = [await storedAlarmId(), await storedAlarmId()];
    await Promise.all(
      enqueuedAlarmIds.map((enqueuedAlarmId: string): Promise<QueryResult> =>
        testDatabase.pool.query(
          `INSERT INTO expansion_jobs (alarm_id, enqueued_at, status, cursor_kind) VALUES ($1, now(), 'IN_PROGRESS', 'FIRST')`,
          [enqueuedAlarmId],
        ),
      ),
    );
    const claimedAt: Date = new Date();
    const leaseUntil: Date = new Date(claimedAt.getTime() + 30_000);
    const workerRepository = (): DrizzleExpansionJobRepositoryAdapter =>
      new DrizzleExpansionJobRepositoryAdapter(
        NotificationDatabaseFactory.create(testDatabase.pool),
      );

    const expansionClaims: ReadonlyArray<ExpansionClaim> = await Promise.all([
      workerRepository().claimNext(claimedAt, leaseUntil),
      workerRepository().claimNext(claimedAt, leaseUntil),
    ]);

    expect(
      expansionClaims
        .map((claim: ExpansionClaim): string => (claim.kind === 'claimed' ? claim.alarmId : 'none'))
        .toSorted(),
    ).toEqual([...enqueuedAlarmIds].toSorted());
  });

  it('DB-18 한 워커가 확장 작업을 잡고 커밋하기 전에도 다른 워커는 기다리지 않고 다음 작업을 가져간다 (SKIP LOCKED)', async (): Promise<void> => {
    await testDatabase.pool.query('TRUNCATE alarms CASCADE');
    const olderAlarmId: string = await storedAlarmId();
    const newerAlarmId: string = await storedAlarmId();
    await testDatabase.pool.query(
      `INSERT INTO expansion_jobs (alarm_id, enqueued_at, status, cursor_kind) VALUES ($1, now() - interval '1 minute', 'IN_PROGRESS', 'FIRST'), ($2, now(), 'IN_PROGRESS', 'FIRST')`,
      [olderAlarmId, newerAlarmId],
    );
    const claimedAt: Date = new Date();
    const leaseUntil: Date = new Date(claimedAt.getTime() + 30_000);
    const holding: Gate = createGate();
    const release: Gate = createGate();
    const holder: Promise<ExpansionClaim> = new DrizzleTransactionAdapter(
      NotificationDatabaseFactory.create(testDatabase.pool),
    ).run(async ({ expansionQueue }: TransactionRepositories): Promise<ExpansionClaim> => {
      const heldClaim: ExpansionClaim = await expansionQueue.claimNext(claimedAt, leaseUntil);
      holding.open();
      await release.opened;
      return heldClaim;
    });
    await holding.opened;
    const lockTimeoutPool: Pool = new Pool({
      connectionString: testDatabase.databaseUrl,
      options: '-c lock_timeout=2000',
    });

    try {
      expect(
        await new DrizzleExpansionJobRepositoryAdapter(
          NotificationDatabaseFactory.create(lockTimeoutPool),
        ).claimNext(claimedAt, leaseUntil),
      ).toEqual({ kind: 'claimed', alarmId: newerAlarmId });
    } finally {
      release.open();
      await Promise.allSettled([holder]);
      await lockTimeoutPool.end();
    }
    expect(await holder).toEqual({ kind: 'claimed', alarmId: olderAlarmId });
  });

  it('DB-18 트랜잭션이 실패하면 그 안에서 건 확장 작업 lease도 롤백되어 바로 다시 claim할 수 있다', async (): Promise<void> => {
    await testDatabase.pool.query('TRUNCATE alarms CASCADE');
    const enqueuedAlarmId: string = await storedAlarmId();
    await testDatabase.pool.query(
      `INSERT INTO expansion_jobs (alarm_id, enqueued_at, status, cursor_kind) VALUES ($1, now(), 'IN_PROGRESS', 'FIRST')`,
      [enqueuedAlarmId],
    );
    const database: NotificationDatabase = NotificationDatabaseFactory.create(testDatabase.pool);
    const claimedAt: Date = new Date();
    const leaseUntil: Date = new Date(claimedAt.getTime() + 30_000);

    await expect(
      new DrizzleTransactionAdapter(database).run(
        async ({ expansionQueue }: TransactionRepositories): Promise<void> => {
          await expansionQueue.claimNext(claimedAt, leaseUntil);
          throw new Error('expansion failed after claim');
        },
      ),
    ).rejects.toThrow('expansion failed after claim');

    expect(
      await new DrizzleExpansionJobRepositoryAdapter(database).claimNext(claimedAt, leaseUntil),
    ).toEqual({ kind: 'claimed', alarmId: enqueuedAlarmId });
  });

  it('UC-06 완료로 바뀌면 이전 cursor 열을 비운다', async (): Promise<void> => {
    const alarmId: string = await storedAlarmId();
    await testDatabase.pool.query(
      `INSERT INTO expansion_jobs (alarm_id, enqueued_at, status, cursor_kind, cursor_token) VALUES ($1, now(), 'IN_PROGRESS', 'NEXT', 'Mw')`,
      [alarmId],
    );
    const database: NotificationDatabase = NotificationDatabaseFactory.create(testDatabase.pool);
    const owner: string = alarmId;
    if (!AlarmPredicates.isAlarmId(owner)) {
      throw new Error('generated alarm id is invalid');
    }

    await new DrizzleExpansionJobRepositoryAdapter(database).recordProgress(owner, {
      kind: 'completed',
      completedAt: new Date('2026-10-08T09:10:00.000Z'),
    });

    const result: QueryResult<CursorColumns> = await testDatabase.pool.query<CursorColumns>(
      `SELECT coalesce(cursor_kind, 'cleared') AS cursor_kind, coalesce(cursor_token, 'cleared') AS cursor_token FROM expansion_jobs WHERE alarm_id = $1`,
      [alarmId],
    );
    expect(result.rows).toEqual([{ cursor_kind: 'cleared', cursor_token: 'cleared' }]);
  });

  it.each<InvalidStateCase>([
    ['허용되지 않은 상태', "'PAUSED', 'FIRST', NULL, NULL, NULL"],
    ['토큰 없는 NEXT cursor', "'IN_PROGRESS', 'NEXT', NULL, NULL, NULL"],
    ['완료 시각 없는 완료', "'COMPLETED', NULL, NULL, NULL, NULL"],
    ['중단 시각 없는 중단', "'STOPPED', NULL, NULL, NULL, NULL"],
  ])('DB 제약은 %s 행을 거부한다', async (_label: string, values: string): Promise<void> => {
    const alarmId: string = await storedAlarmId();

    await expect(
      testDatabase.pool.query(
        `INSERT INTO expansion_jobs (alarm_id, enqueued_at, status, cursor_kind, cursor_token, completed_at, stopped_at) VALUES ($1, now(), ${values})`,
        [alarmId],
      ),
    ).rejects.toThrow('violates check constraint');
  });
});
