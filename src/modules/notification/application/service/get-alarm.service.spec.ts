import { describe, expect, it } from 'vitest';
import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import {
  AlarmCreated,
  AlarmCreation,
  AlarmId,
  RecipientId,
} from '@/modules/notification/domain/alarm/alarm.type';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import {
  DeliveryId,
  DeliveryTransition,
} from '@/modules/notification/domain/delivery/delivery.type';
import { TransactionPort } from '@/modules/notification/application/port/out/transaction.port';
import {
  SnapshotWork,
  TransactionRepositories,
  TransactionWork,
} from '@/modules/notification/application/port/out/transaction.type';
import {
  AlarmFoundResult,
  AlarmResult,
} from '@/modules/notification/application/port/in/alarm-result.type';
import { DeliveryProgressView } from '@/modules/notification/application/port/in/delivery-progress-view.type';
import { AlarmViewMapper } from '@/modules/notification/application/service/alarm-view.mapper';
import { GetAlarmService } from '@/modules/notification/application/service/get-alarm.service';
import { InMemoryAlarmRepositoryAdapter } from '@/modules/notification/adapter/out/in-memory/in-memory-alarm-repository.adapter';
import { InMemoryDeliveryRepositoryAdapter } from '@/modules/notification/adapter/out/in-memory/in-memory-delivery-repository.adapter';
import { InMemoryExpansionJobRepositoryAdapter } from '@/modules/notification/adapter/out/in-memory/in-memory-expansion-job-repository.adapter';
import { InMemoryTransactionAdapter } from '@/modules/notification/adapter/out/in-memory/in-memory-transaction.adapter';
import { UnusedTransaction } from '@/modules/notification/testing/unused-transaction';

const STORED_ID: string = '0b6c1b4e-9a37-4c2a-8d6a-2f6b2d7f1a10';
const MISSING_ID: string = '7d3f1e2a-4b5c-4d6e-8f70-1a2b3c4d5e6f';

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

class SnapshotOnlyTransaction implements TransactionPort {
  constructor(private readonly snapshotSource: InMemoryTransactionAdapter) {}

  run<TResult>(_work: TransactionWork<TResult>): Promise<TResult> {
    return Promise.reject(new Error('alarm lookup must read through a snapshot'));
  }

  readSnapshot<TResult>(work: SnapshotWork<TResult>): Promise<TResult> {
    return this.snapshotSource.readSnapshot(work);
  }
}

interface Fixture {
  readonly alarmRepository: InMemoryAlarmRepositoryAdapter;
  readonly deliveryRepository: InMemoryDeliveryRepositoryAdapter;
  readonly transaction: InMemoryTransactionAdapter;
  readonly service: GetAlarmService;
}

const alarmId = (value: string): AlarmId => {
  if (!AlarmPredicates.isAlarmId(value)) {
    throw new Error(`test fixture ${value} is not a valid AlarmId`);
  }
  return value;
};

const storedAlarm = (): Alarm => {
  const creation: AlarmCreation = Alarm.create(
    alarmId(STORED_ID),
    { title: '추석 이벤트', body: '연휴 쿠폰이 도착했어요', kind: 'BULK', recipientIds: [] },
    new Date('2026-10-07T09:00:00.000Z'),
  );
  if (creation.kind !== 'created') {
    throw new Error(`test fixture alarm is invalid: ${creation.error.code}`);
  }
  const { alarm }: AlarmCreated = creation;
  return alarm;
};

const found = (result: AlarmResult): AlarmFoundResult => {
  if (result.kind !== 'found') {
    throw new Error(`expected found but got ${result.kind}`);
  }
  return result;
};

const pendingDelivery = (deliveryNumber: number, recipient: string): Delivery => {
  const rawDeliveryId: string = `00000000-0000-4000-8000-${String(deliveryNumber).padStart(12, '0')}`;
  if (!DeliveryPredicates.isDeliveryId(rawDeliveryId)) {
    throw new Error(`test fixture ${rawDeliveryId} is not a valid DeliveryId`);
  }
  if (!AlarmPredicates.isRecipientId(recipient)) {
    throw new Error(`test fixture ${recipient} is not a valid RecipientId`);
  }
  const deliveryId: DeliveryId = rawDeliveryId;
  const recipientId: RecipientId = recipient;
  return Delivery.create(
    { id: deliveryId, alarmId: alarmId(STORED_ID), recipientId, priority: 'BULK' },
    new Date('2026-10-07T09:05:00.000Z'),
  );
};

const cancelled = (delivery: Delivery): Delivery => {
  const transition: DeliveryTransition = delivery.cancel(new Date('2026-10-07T09:10:00.000Z'));
  if (transition.kind !== 'transitioned') {
    throw new Error(`test fixture delivery cannot be cancelled: ${transition.kind}`);
  }
  return transition.delivery;
};

const fixture = (): Fixture => {
  const alarmRepository: InMemoryAlarmRepositoryAdapter = new InMemoryAlarmRepositoryAdapter();
  const deliveryRepository: InMemoryDeliveryRepositoryAdapter =
    new InMemoryDeliveryRepositoryAdapter();
  const transaction: InMemoryTransactionAdapter = new InMemoryTransactionAdapter({
    alarmRepository,
    deliveryRepository,
    expansionJobRepository: new InMemoryExpansionJobRepositoryAdapter(),
  });
  return {
    alarmRepository,
    deliveryRepository,
    transaction,
    service: new GetAlarmService(new SnapshotOnlyTransaction(transaction)),
  };
};

describe('GetAlarmService', () => {
  it('UC-16 Delivery가 있는 알림 / 조회 유스케이스 → 알림과 상태별 Delivery 수를 같은 스냅샷에서 함께 반환한다', async (): Promise<void> => {
    const { alarmRepository, deliveryRepository, service }: Fixture = fixture();
    const alarm: Alarm = storedAlarm();
    await alarmRepository.save(alarm);
    await deliveryRepository.saveAll([
      pendingDelivery(1, 'u_000001'),
      pendingDelivery(2, 'u_000002'),
      cancelled(pendingDelivery(3, 'u_000003')),
    ]);

    const { alarm: alarmView, deliveries }: AlarmFoundResult = found(
      await service.execute({ alarmId: STORED_ID }),
    );

    expect(alarmView).toEqual(AlarmViewMapper.toView(alarm));
    expect(deliveries).toEqual<DeliveryProgressView>({
      total: 3,
      byStatus: {
        PENDING: 2,
        IN_FLIGHT: 0,
        RETRY_WAIT: 0,
        UNKNOWN: 0,
        SENT: 0,
        FAILED: 0,
        UNCONFIRMED: 0,
        CANCELLED: 1,
      },
    });
  });

  it('UC-02 없는 알림 id / 조회·발송 시작·취소 → 알림 없음 오류가 난다', async (): Promise<void> => {
    const { alarmRepository, service }: Fixture = fixture();
    await alarmRepository.save(storedAlarm());

    const result: AlarmResult = await service.execute({ alarmId: MISSING_ID });

    expect(result).toEqual({
      kind: 'not-found',
      error: { code: 'ALARM_NOT_FOUND', alarmId: MISSING_ID },
    });
  });

  it('UC-02 알림 id 형식이 아닌 값으로 조회하면 저장소를 거치지 않고 알림 없음 오류가 난다', async (): Promise<void> => {
    const service: GetAlarmService = new GetAlarmService(new UnusedTransaction());

    const result: AlarmResult = await service.execute({ alarmId: 'not-a-uuid' });

    expect(result).toEqual({
      kind: 'not-found',
      error: { code: 'ALARM_NOT_FOUND', alarmId: 'not-a-uuid' },
    });
  });

  it('UC-02 커밋되지 않은 다른 트랜잭션의 저장은 조회되지 않는다', async (): Promise<void> => {
    const { transaction, service }: Fixture = fixture();
    const uncommittedSaved: Gate = createGate();
    const failureReleased: Gate = createGate();
    const failing: Promise<void> = transaction.run(
      async ({ alarmRepository }: TransactionRepositories): Promise<void> => {
        await alarmRepository.save(storedAlarm());
        uncommittedSaved.open();
        await failureReleased.opened;
        throw new Error('other transaction failed');
      },
    );
    await uncommittedSaved.opened;

    const result: Promise<AlarmResult> = service.execute({ alarmId: STORED_ID });
    failureReleased.open();

    await expect(failing).rejects.toThrow('other transaction failed');
    expect((await result).kind).toBe('not-found');
  });
});
