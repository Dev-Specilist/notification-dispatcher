import { randomUUID } from 'node:crypto';
import { QueryResult } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { AlarmCreation, AlarmTransition } from '@/modules/notification/domain/alarm/alarm.type';
import { AlarmRepositoryContract } from '@/modules/notification/testing/contract/alarm-repository.contract';
import { DrizzleAlarmRepositoryAdapter } from '@/modules/notification/adapter/out/persistence/drizzle-alarm-repository.adapter';
import { NotificationDatabaseFactory } from '@/modules/notification/adapter/out/persistence/notification-database.factory';
import { TestDatabase } from '@/shared/database/testing/test-database';

interface TimestampRow {
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly updated_micros: string;
}

const draftAlarm = (): Alarm => {
  const id: string = randomUUID();
  if (!AlarmPredicates.isAlarmId(id)) {
    throw new Error(`generated ${id} is not a valid AlarmId`);
  }
  const creation: AlarmCreation = Alarm.create(
    id,
    { title: '추석 이벤트', body: '쿠폰 도착', kind: 'BULK', recipientIds: [] },
    new Date('2020-01-01T00:00:00.000Z'),
  );
  if (creation.kind !== 'created') {
    throw new Error(`test fixture alarm is invalid: ${creation.error.code}`);
  }
  return creation.alarm;
};

const dispatched = (alarm: Alarm): Alarm => {
  const transition: AlarmTransition = alarm.startDispatch(new Date('2020-01-01T00:01:00.000Z'));
  if (transition.kind !== 'transitioned') {
    throw new Error(`test fixture transition failed: ${transition.error.code}`);
  }
  return transition.alarm;
};

describe('DrizzleAlarmRepositoryAdapter', () => {
  let testDatabase: TestDatabase;

  const timestampsOf = async (alarm: Alarm): Promise<TimestampRow> => {
    const result: QueryResult<TimestampRow> = await testDatabase.pool.query<TimestampRow>(
      'SELECT created_at, updated_at, (EXTRACT(EPOCH FROM updated_at) * 1000000)::bigint::text AS updated_micros FROM alarms WHERE id = $1',
      [alarm.snapshot().id],
    );
    const [row]: ReadonlyArray<TimestampRow> = result.rows;
    return row;
  };

  beforeAll(async (): Promise<void> => {
    testDatabase = await TestDatabase.create();
  });

  afterAll(async (): Promise<void> => {
    await testDatabase.drop();
  });

  AlarmRepositoryContract.verify(async (): Promise<DrizzleAlarmRepositoryAdapter> => {
    await testDatabase.pool.query('TRUNCATE alarms CASCADE');
    return new DrizzleAlarmRepositoryAdapter(NotificationDatabaseFactory.create(testDatabase.pool));
  });

  it('DB-01 저장할 때마다 updated_at을 DB 시각으로 갱신하고 created_at은 유지한다', async (): Promise<void> => {
    const repository: DrizzleAlarmRepositoryAdapter = new DrizzleAlarmRepositoryAdapter(
      NotificationDatabaseFactory.create(testDatabase.pool),
    );
    const alarm: Alarm = draftAlarm();
    await repository.save(alarm);
    const first: TimestampRow = await timestampsOf(alarm);

    await repository.save(dispatched(alarm));
    const second: TimestampRow = await timestampsOf(alarm);

    expect(second.created_at).toEqual(first.created_at);
    expect(BigInt(second.updated_micros)).toBeGreaterThan(BigInt(first.updated_micros));
    expect(first.updated_at.getTime()).toBeGreaterThan(first.created_at.getTime());
  });
});
