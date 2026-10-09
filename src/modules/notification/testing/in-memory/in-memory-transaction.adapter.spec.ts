import { describe, expect, it } from 'vitest';
import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import {
  AlarmCreation,
  AlarmId,
  RecipientId,
} from '@/modules/notification/domain/alarm/alarm.type';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import { DeliveryId } from '@/modules/notification/domain/delivery/delivery.type';
import {
  SnapshotRepositories,
  TransactionRepositories,
} from '@/modules/notification/application/port/driven/for-running-transactions/transaction.type';
import { InMemoryAlarmRepositoryAdapter } from '@/modules/notification/testing/in-memory/in-memory-alarm-repository.adapter';
import { InMemoryDeliveryRepositoryAdapter } from '@/modules/notification/testing/in-memory/in-memory-delivery-repository.adapter';
import { InMemoryExpansionJobRepositoryAdapter } from '@/modules/notification/testing/in-memory/in-memory-expansion-job-repository.adapter';
import { InMemoryTransactionAdapter } from '@/modules/notification/testing/in-memory/in-memory-transaction.adapter';
import { KindAssertion, KindMember } from '@/shared/testing/kind.assertion';

type SnapshotReading = Readonly<[alarmLookupKind: string, pendingCount: number]>;

interface Fixture {
  readonly alarmRepository: InMemoryAlarmRepositoryAdapter;
  readonly expansionJobRepository: InMemoryExpansionJobRepositoryAdapter;
  readonly transaction: InMemoryTransactionAdapter;
}

const ENQUEUED_ISO: string = '2026-10-07T09:05:00.000Z';
const FIRST_ID: string = '0b6c1b4e-9a37-4c2a-8d6a-2f6b2d7f1a10';
const SECOND_ID: string = '7d3f1e2a-4b5c-4d6e-8f70-1a2b3c4d5e6f';

const alarmId = (value: string): AlarmId => {
  if (!AlarmPredicates.isAlarmId(value)) {
    throw new Error(`test fixture ${value} is not a valid AlarmId`);
  }
  return value;
};

const bulkAlarm = (rawAlarmId: string): Alarm => {
  const creation: AlarmCreation = Alarm.create(
    alarmId(rawAlarmId),
    { title: '추석 이벤트', body: '쿠폰 도착', kind: 'BULK', recipientIds: [] },
    new Date('2026-10-07T09:00:00.000Z'),
  );
  KindAssertion.assertKind(creation, 'created');
  const { alarm }: KindMember<AlarmCreation, 'created'> = creation;
  return alarm;
};

const pendingDelivery = (id: number, recipient: string): Delivery => {
  const deliveryValue: string = `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`;
  if (!DeliveryPredicates.isDeliveryId(deliveryValue)) {
    throw new Error(`test fixture ${deliveryValue} is not a valid DeliveryId`);
  }
  if (!AlarmPredicates.isRecipientId(recipient)) {
    throw new Error(`test fixture ${recipient} is not a valid RecipientId`);
  }
  const deliveryIdValue: DeliveryId = deliveryValue;
  const recipientIdValue: RecipientId = recipient;
  return Delivery.create(
    {
      id: deliveryIdValue,
      alarmId: alarmId(FIRST_ID),
      recipientId: recipientIdValue,
      priority: 'BULK',
    },
    new Date(ENQUEUED_ISO),
  );
};

const fixture = (): Fixture => {
  const alarmRepository: InMemoryAlarmRepositoryAdapter = new InMemoryAlarmRepositoryAdapter();
  const expansionJobRepository: InMemoryExpansionJobRepositoryAdapter =
    new InMemoryExpansionJobRepositoryAdapter();
  return {
    alarmRepository,
    expansionJobRepository,
    transaction: new InMemoryTransactionAdapter({
      alarmRepository,
      deliveryRepository: new InMemoryDeliveryRepositoryAdapter(),
      expansionJobRepository,
    }),
  };
};

describe('InMemoryTransactionAdapter', () => {
  it('동시에 시작한 트랜잭션은 하나씩 차례로 실행되어 서로의 중간 상태를 보지 않는다', async (): Promise<void> => {
    const { transaction }: Fixture = fixture();
    const order: Array<string> = [];

    await Promise.all([
      transaction.run(async (): Promise<void> => {
        order.push('first:start');
        await Promise.resolve();
        await Promise.resolve();
        order.push('first:end');
      }),
      transaction.run((): Promise<void> => {
        order.push('second:start');
        order.push('second:end');
        return Promise.resolve();
      }),
    ]);

    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('스냅샷 조회는 실행 중인 트랜잭션이 끝난 뒤 실행되어 함께 커밋된 알림과 상태별 Delivery 수를 같이 본다', async (): Promise<void> => {
    const { transaction }: Fixture = fixture();
    const savedAlarmId: AlarmId = alarmId(FIRST_ID);

    const savingAlarmWithDelivery: Promise<void> = transaction.run(
      async ({ alarmRepository, deliveryRepository }: TransactionRepositories): Promise<void> => {
        await alarmRepository.save(bulkAlarm(FIRST_ID));
        await Promise.resolve();
        await deliveryRepository.saveAll([pendingDelivery(1, 'u_000001')]);
      },
    );
    const snapshotReading: Promise<SnapshotReading> = transaction.readSnapshot(
      async ({
        alarmRepository,
        deliveryRepository,
      }: SnapshotRepositories): Promise<SnapshotReading> => [
        (await alarmRepository.findById(savedAlarmId)).kind,
        (await deliveryRepository.countByStatus(savedAlarmId)).PENDING,
      ],
    );
    await savingAlarmWithDelivery;

    expect(await snapshotReading).toEqual(['found', 1]);
  });

  it('한 트랜잭션이 실패해 롤백돼도 다른 트랜잭션이 커밋한 변경은 남는다', async (): Promise<void> => {
    const { alarmRepository, transaction }: Fixture = fixture();

    const results: ReadonlyArray<PromiseSettledResult<void>> = await Promise.allSettled([
      transaction.run(
        async ({ alarmRepository: repository }: TransactionRepositories): Promise<void> => {
          await repository.save(bulkAlarm(FIRST_ID));
          throw new Error('first transaction failed');
        },
      ),
      transaction.run(({ alarmRepository: repository }: TransactionRepositories): Promise<void> =>
        repository.save(bulkAlarm(SECOND_ID)),
      ),
    ]);

    expect(results.map((result: PromiseSettledResult<void>): string => result.status)).toEqual([
      'rejected',
      'fulfilled',
    ]);
    expect((await alarmRepository.findById(alarmId(FIRST_ID))).kind).toBe('missing');
    expect((await alarmRepository.findById(alarmId(SECOND_ID))).kind).toBe('found');
  });

  it('앞선 트랜잭션이 실패해도 다음 트랜잭션은 계속 실행된다', async (): Promise<void> => {
    const { transaction }: Fixture = fixture();
    const failed: Promise<void> = transaction.run((): Promise<void> =>
      Promise.reject(new Error('first transaction failed')),
    );

    const next: Promise<string> = transaction.run((): Promise<string> => Promise.resolve('ran'));

    await expect(failed).rejects.toThrow('first transaction failed');
    expect(await next).toBe('ran');
  });

  it('DB-18 트랜잭션이 실패하면 그 안에서 건 확장 작업 lease도 되돌아가 바로 다시 claim할 수 있다', async (): Promise<void> => {
    const { expansionJobRepository, transaction }: Fixture = fixture();
    const claimedAt: Date = new Date('2026-10-07T09:06:00.000Z');
    const leaseUntil: Date = new Date('2026-10-07T09:06:30.000Z');
    await expansionJobRepository.enqueue(alarmId(FIRST_ID), new Date(ENQUEUED_ISO));

    await expect(
      transaction.run(
        async ({
          expansionJobRepository: expansionJobRepositoryInTransaction,
        }: TransactionRepositories): Promise<void> => {
          await expansionJobRepositoryInTransaction.claimNext(claimedAt, leaseUntil);
          throw new Error('expansion failed after claim');
        },
      ),
    ).rejects.toThrow('expansion failed after claim');

    expect(await expansionJobRepository.claimNext(claimedAt, leaseUntil)).toEqual({
      kind: 'claimed',
      alarmId: FIRST_ID,
    });
  });
});
