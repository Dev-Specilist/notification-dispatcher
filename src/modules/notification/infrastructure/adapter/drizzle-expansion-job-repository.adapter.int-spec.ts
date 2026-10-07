import { randomUUID } from 'node:crypto';
import { QueryResult } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExpansionJobRepositoryContract } from '@/modules/notification/application/port/expansion-job-repository.contract';
import { DrizzleAlarmRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/drizzle-alarm-repository.adapter';
import { DrizzleExpansionJobRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/drizzle-expansion-job-repository.adapter';
import { NotificationDatabaseFactory } from '@/modules/notification/infrastructure/persistence/notification-database.factory';
import { NotificationDatabase } from '@/modules/notification/infrastructure/persistence/notification-database.type';
import { TestDatabase } from '@/shared/database/testing/test-database';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';

interface DrizzleRepositories {
  readonly alarmRepository: DrizzleAlarmRepositoryAdapter;
  readonly expansionJobRepository: DrizzleExpansionJobRepositoryAdapter;
}

interface CursorColumns {
  readonly cursor_kind: string;
  readonly cursor_token: string;
}

type InvalidStateCase = Readonly<[string, string]>;

describe('DrizzleExpansionJobRepositoryAdapter', () => {
  let testDatabase: TestDatabase;

  beforeAll(async (): Promise<void> => {
    testDatabase = await TestDatabase.create();
  });

  afterAll(async (): Promise<void> => {
    await testDatabase.drop();
  });

  ExpansionJobRepositoryContract.verify((): Promise<DrizzleRepositories> => {
    const database: NotificationDatabase = NotificationDatabaseFactory.create(testDatabase.pool);
    return Promise.resolve({
      alarmRepository: new DrizzleAlarmRepositoryAdapter(database),
      expansionJobRepository: new DrizzleExpansionJobRepositoryAdapter(database),
    });
  });

  const storedAlarmId = async (): Promise<string> => {
    const alarmId: string = randomUUID();
    await testDatabase.pool.query(
      `INSERT INTO alarms (id, title, body, kind, recipient_ids, status, created_at) VALUES ($1, 't', 'b', 'BULK', '{}', 'DRAFT', now())`,
      [alarmId],
    );
    return alarmId;
  };

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
