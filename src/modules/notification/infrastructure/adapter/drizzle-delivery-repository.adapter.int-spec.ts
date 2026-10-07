import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DeliveryRepositoryContract } from '@/modules/notification/application/port/delivery-repository.contract';
import { DrizzleAlarmRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/drizzle-alarm-repository.adapter';
import { DrizzleDeliveryRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/drizzle-delivery-repository.adapter';
import { NotificationDatabaseFactory } from '@/modules/notification/infrastructure/persistence/notification-database.factory';
import { NotificationDatabase } from '@/modules/notification/infrastructure/persistence/notification-database.type';
import { TestDatabase } from '@/shared/database/testing/test-database';

interface DrizzleRepositories {
  readonly alarmRepository: DrizzleAlarmRepositoryAdapter;
  readonly deliveryRepository: DrizzleDeliveryRepositoryAdapter;
}

type InvalidStateCase = Readonly<[string, string]>;

describe('DrizzleDeliveryRepositoryAdapter', () => {
  let testDatabase: TestDatabase;

  beforeAll(async (): Promise<void> => {
    testDatabase = await TestDatabase.create();
  });

  afterAll(async (): Promise<void> => {
    await testDatabase.drop();
  });

  DeliveryRepositoryContract.verify(async (): Promise<DrizzleRepositories> => {
    await testDatabase.pool.query('TRUNCATE deliveries, alarms');
    const database: NotificationDatabase = NotificationDatabaseFactory.create(testDatabase.pool);
    return {
      alarmRepository: new DrizzleAlarmRepositoryAdapter(database),
      deliveryRepository: new DrizzleDeliveryRepositoryAdapter(database),
    };
  });

  it.each<InvalidStateCase>([
    ['IN_FLIGHT인데 lease 열이 없다', "status = 'IN_FLIGHT'"],
    [
      'RETRY_WAIT인데 허용되지 않은 재시도 원인이다',
      "status = 'RETRY_WAIT', retry_at = now(), retry_cause = 'SOMETHING_ELSE'",
    ],
    [
      'UNKNOWN인데 조회 실패 횟수가 음수다',
      "status = 'UNKNOWN', unknown_since = now(), reconcile_at = now(), lookup_failures = -1",
    ],
    ['SENT인데 중복 건수가 없다', "status = 'SENT', message_id = 'm_1', sent_at = now()"],
    ['FAILED인데 허용되지 않은 실패 사유다', "status = 'FAILED', failure_reason = 'BECAUSE'"],
    ['CANCELLED인데 취소 시각이 없다', "status = 'CANCELLED'"],
  ])(
    'DB 제약은 %s 행을 거부한다',
    async (_label: string, invalidAssignment: string): Promise<void> => {
      const alarmId: string = randomUUID();
      const deliveryId: string = randomUUID();
      await testDatabase.pool.query(
        `INSERT INTO alarms (id, title, body, kind, recipient_ids, status, created_at) VALUES ($1, 't', 'b', 'BULK', '{}', 'DRAFT', now())`,
        [alarmId],
      );
      await testDatabase.pool.query(
        `INSERT INTO deliveries (id, alarm_id, recipient_id, priority, attempts, status, created_at) VALUES ($1, $2, 'u_000001', 'BULK', 0, 'PENDING', now())`,
        [deliveryId, alarmId],
      );

      await expect(
        testDatabase.pool.query(`UPDATE deliveries SET ${invalidAssignment} WHERE id = $1`, [
          deliveryId,
        ]),
      ).rejects.toThrow('violates check constraint');
    },
  );

  it.todo(
    'DB-06 대기 Delivery 100건 / 워커 3개가 동시에 claim한다 (FOR UPDATE SKIP LOCKED) → 같은 Delivery를 두 워커가 가져가지 않는다',
  );
});
