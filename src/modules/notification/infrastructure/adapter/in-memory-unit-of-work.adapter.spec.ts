import { describe, expect, it } from 'vitest';
import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { AlarmCreation, AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { ExpansionJobLookup } from '@/modules/notification/application/port/expansion-job-repository.type';
import { TransactionRepositories } from '@/modules/notification/application/port/unit-of-work.type';
import { InMemoryAlarmRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-alarm-repository.adapter';
import { InMemoryDeliveryRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-delivery-repository.adapter';
import { InMemoryExpansionJobRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-expansion-job-repository.adapter';
import { InMemoryUnitOfWorkAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-unit-of-work.adapter';

interface Fixture {
  readonly alarmRepository: InMemoryAlarmRepositoryAdapter;
  readonly expansionJobRepository: InMemoryExpansionJobRepositoryAdapter;
  readonly unitOfWork: InMemoryUnitOfWorkAdapter;
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

const bulkAlarm = (id: string): Alarm => {
  const creation: AlarmCreation = Alarm.create(
    alarmId(id),
    { title: '추석 이벤트', body: '쿠폰 도착', kind: 'BULK', recipientIds: [] },
    new Date('2026-10-07T09:00:00.000Z'),
  );
  if (creation.kind !== 'created') {
    throw new Error(`test fixture alarm is invalid: ${creation.error.code}`);
  }
  return creation.alarm;
};

const fixture = (): Fixture => {
  const alarmRepository: InMemoryAlarmRepositoryAdapter = new InMemoryAlarmRepositoryAdapter();
  const expansionJobRepository: InMemoryExpansionJobRepositoryAdapter =
    new InMemoryExpansionJobRepositoryAdapter();
  return {
    alarmRepository,
    expansionJobRepository,
    unitOfWork: new InMemoryUnitOfWorkAdapter({
      alarmRepository,
      deliveryRepository: new InMemoryDeliveryRepositoryAdapter(),
      expansionJobRepository,
    }),
  };
};

describe('InMemoryUnitOfWorkAdapter', () => {
  it('동시에 시작한 트랜잭션은 하나씩 차례로 실행되어 서로의 중간 상태를 보지 않는다', async (): Promise<void> => {
    const { unitOfWork }: Fixture = fixture();
    const order: Array<string> = [];

    await Promise.all([
      unitOfWork.run(async (): Promise<void> => {
        order.push('first:start');
        await Promise.resolve();
        await Promise.resolve();
        order.push('first:end');
      }),
      unitOfWork.run((): Promise<void> => {
        order.push('second:start');
        order.push('second:end');
        return Promise.resolve();
      }),
    ]);

    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('한 트랜잭션이 실패해 롤백돼도 다른 트랜잭션이 커밋한 변경은 남는다', async (): Promise<void> => {
    const { alarmRepository, unitOfWork }: Fixture = fixture();

    const results: ReadonlyArray<PromiseSettledResult<void>> = await Promise.allSettled([
      unitOfWork.run(
        async ({ alarmRepository: repository }: TransactionRepositories): Promise<void> => {
          await repository.save(bulkAlarm(FIRST_ID));
          throw new Error('first transaction failed');
        },
      ),
      unitOfWork.run(({ alarmRepository: repository }: TransactionRepositories): Promise<void> =>
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
    const { unitOfWork }: Fixture = fixture();
    const failed: Promise<void> = unitOfWork.run((): Promise<void> =>
      Promise.reject(new Error('first transaction failed')),
    );

    const next: Promise<string> = unitOfWork.run((): Promise<string> => Promise.resolve('ran'));

    await expect(failed).rejects.toThrow('first transaction failed');
    expect(await next).toBe('ran');
  });
});

describe('InMemoryExpansionJobRepositoryAdapter', () => {
  it('조회한 확장 작업의 Date를 바꿔도 저장된 값은 바뀌지 않는다', async (): Promise<void> => {
    const { expansionJobRepository }: Fixture = fixture();
    await expansionJobRepository.enqueue(alarmId(FIRST_ID), new Date(ENQUEUED_ISO));

    const lookup: ExpansionJobLookup = await expansionJobRepository.findByAlarmId(
      alarmId(FIRST_ID),
    );
    if (lookup.kind === 'found') {
      lookup.job.enqueuedAt.setUTCFullYear(1990);
    }

    expect(await expansionJobRepository.findByAlarmId(alarmId(FIRST_ID))).toEqual({
      kind: 'found',
      job: { alarmId: FIRST_ID, enqueuedAt: new Date(ENQUEUED_ISO) },
    });
  });
});
