import { describe, expect, it } from 'vitest';
import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { AlarmCreation, AlarmDraft, AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import { DeliveryId, DeliverySnapshot } from '@/modules/notification/domain/delivery/delivery.type';
import { AlarmLookup } from '@/modules/notification/application/port/alarm-repository.type';
import { ClockPort } from '@/modules/notification/application/port/clock.port';
import { IdGeneratorPort } from '@/modules/notification/application/port/id-generator.port';
import { StartDispatchResult } from '@/modules/notification/application/use-case/alarm-result.type';
import { StartDispatchUseCase } from '@/modules/notification/application/use-case/start-dispatch.use-case';
import { InMemoryAlarmRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-alarm-repository.adapter';
import { InMemoryDeliveryRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-delivery-repository.adapter';
import { InMemoryExpansionJobRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-expansion-job-repository.adapter';
import { InMemoryUnitOfWorkAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-unit-of-work.adapter';

type DeliverySummary = Pick<DeliverySnapshot, 'recipientId' | 'priority' | 'state' | 'createdAt'>;

const CREATED_ISO: string = '2026-10-07T09:00:00.000Z';
const DISPATCHED_ISO: string = '2026-10-07T09:05:00.000Z';
const ALARM_ID: string = '0b6c1b4e-9a37-4c2a-8d6a-2f6b2d7f1a10';
const MISSING_ALARM_ID: string = '7d3f1e2a-4b5c-4d6e-8f70-1a2b3c4d5e6f';

const alarmId = (value: string): AlarmId => {
  if (!AlarmPredicates.isAlarmId(value)) {
    throw new Error(`test fixture ${value} is not a valid AlarmId`);
  }
  return value;
};

const draftAlarm = (draft: Readonly<AlarmDraft>): Alarm => {
  const creation: AlarmCreation = Alarm.create(alarmId(ALARM_ID), draft, new Date(CREATED_ISO));
  if (creation.kind !== 'created') {
    throw new Error(`test fixture alarm is invalid: ${creation.error.code}`);
  }
  return creation.alarm;
};

const urgentDraft = (): Alarm =>
  draftAlarm({
    title: '서버 점검',
    body: '10분 뒤 점검',
    kind: 'URGENT',
    recipientIds: ['u_000001', 'u_000002'],
  });

const bulkDraft = (): Alarm =>
  draftAlarm({ title: '추석 이벤트', body: '쿠폰 도착', kind: 'BULK', recipientIds: [] });

const found = (lookup: AlarmLookup): Alarm => {
  if (lookup.kind !== 'found') {
    throw new Error('expected the alarm to be stored');
  }
  return lookup.alarm;
};

class FixedClock implements ClockPort {
  now(): Date {
    return new Date(DISPATCHED_ISO);
  }
}

class SequentialIdGenerator implements IdGeneratorPort {
  private issued: number = 0;

  alarmId(): AlarmId {
    return alarmId(ALARM_ID);
  }

  deliveryId(): DeliveryId {
    this.issued += 1;
    const value: string = `00000000-0000-4000-8000-${String(this.issued).padStart(12, '0')}`;
    if (!DeliveryPredicates.isDeliveryId(value)) {
      throw new Error(`generated ${value} is not a valid DeliveryId`);
    }
    return value;
  }
}

class FailingExpansionJobRepository extends InMemoryExpansionJobRepositoryAdapter {
  override enqueue(): Promise<void> {
    return Promise.reject(new Error('expansion job storage is unavailable'));
  }
}

class FailingDeliveryRepository extends InMemoryDeliveryRepositoryAdapter {
  override saveAll(): Promise<void> {
    return Promise.reject(new Error('delivery storage is unavailable'));
  }
}

class PartiallySavingDeliveryRepository extends InMemoryDeliveryRepositoryAdapter {
  override async saveAll(deliveries: ReadonlyArray<Delivery>): Promise<void> {
    await super.saveAll(deliveries.slice(0, 1));
    throw new Error('delivery storage failed midway');
  }
}

interface Fixture {
  readonly alarmRepository: InMemoryAlarmRepositoryAdapter;
  readonly deliveryRepository: InMemoryDeliveryRepositoryAdapter;
  readonly expansionJobRepository: InMemoryExpansionJobRepositoryAdapter;
  readonly useCase: StartDispatchUseCase;
}

const fixture = async (
  stored: ReadonlyArray<Alarm>,
  deliveryRepository: InMemoryDeliveryRepositoryAdapter = new InMemoryDeliveryRepositoryAdapter(),
  expansionJobRepository: InMemoryExpansionJobRepositoryAdapter = new InMemoryExpansionJobRepositoryAdapter(),
): Promise<Fixture> => {
  const alarmRepository: InMemoryAlarmRepositoryAdapter = new InMemoryAlarmRepositoryAdapter();
  await Promise.all(stored.map((alarm: Alarm): Promise<void> => alarmRepository.save(alarm)));
  const unitOfWork: InMemoryUnitOfWorkAdapter = new InMemoryUnitOfWorkAdapter({
    alarmRepository,
    deliveryRepository,
    expansionJobRepository,
  });
  return {
    alarmRepository,
    deliveryRepository,
    expansionJobRepository,
    useCase: new StartDispatchUseCase(unitOfWork, new SequentialIdGenerator(), new FixedClock()),
  };
};

const storedStatus = async (alarmRepository: InMemoryAlarmRepositoryAdapter): Promise<string> =>
  found(await alarmRepository.findById(alarmId(ALARM_ID))).snapshot().state.status;

describe('StartDispatchUseCase', () => {
  it('UC-02 없는 알림 id / 조회·발송 시작·취소 → 알림 없음 오류가 난다', async (): Promise<void> => {
    const { useCase }: Fixture = await fixture([bulkDraft()]);

    expect(await useCase.execute(alarmId(MISSING_ALARM_ID))).toEqual({
      kind: 'not-found',
      error: { code: 'ALARM_NOT_FOUND', alarmId: MISSING_ALARM_ID },
    });
  });

  it('UC-03 긴급 DRAFT 알림 / 발송 시작 → 같은 트랜잭션에서 상태 변경과 수신자별 Delivery 생성이 함께 커밋된다', async (): Promise<void> => {
    const { alarmRepository, deliveryRepository, useCase }: Fixture = await fixture([
      urgentDraft(),
    ]);

    const result: StartDispatchResult = await useCase.execute(alarmId(ALARM_ID));
    const deliveries: ReadonlyArray<Delivery> = await deliveryRepository.findByAlarmId(
      alarmId(ALARM_ID),
    );

    expect(result.kind).toBe('dispatched');
    expect(found(await alarmRepository.findById(alarmId(ALARM_ID))).snapshot().state).toEqual({
      status: 'DISPATCHING',
      dispatchedAt: new Date(DISPATCHED_ISO),
    });
    expect(
      deliveries.map((delivery: Delivery): DeliverySummary => {
        const { recipientId, priority, state, createdAt }: DeliverySnapshot = delivery.snapshot();
        return { recipientId, priority, state, createdAt };
      }),
    ).toEqual([
      {
        recipientId: 'u_000001',
        priority: 'URGENT',
        state: { status: 'PENDING' },
        createdAt: new Date(DISPATCHED_ISO),
      },
      {
        recipientId: 'u_000002',
        priority: 'URGENT',
        state: { status: 'PENDING' },
        createdAt: new Date(DISPATCHED_ISO),
      },
    ]);
  });

  it('UC-04 대량 DRAFT 알림 / 발송 시작 → 같은 트랜잭션에서 상태 변경과 확장 작업 생성이 함께 커밋된다', async (): Promise<void> => {
    const { alarmRepository, deliveryRepository, expansionJobRepository, useCase }: Fixture =
      await fixture([bulkDraft()]);

    const result: StartDispatchResult = await useCase.execute(alarmId(ALARM_ID));

    expect(result.kind).toBe('dispatched');
    expect(await storedStatus(alarmRepository)).toBe('DISPATCHING');
    expect(await expansionJobRepository.findByAlarmId(alarmId(ALARM_ID))).toEqual({
      kind: 'found',
      job: {
        alarmId: ALARM_ID,
        enqueuedAt: new Date(DISPATCHED_ISO),
        progress: { kind: 'in-progress', cursor: { kind: 'first' } },
      },
    });
    expect(await deliveryRepository.findByAlarmId(alarmId(ALARM_ID))).toEqual([]);
  });

  it('UC-05 발송 시작 중 / 작업 생성이 실패한다 → 전체가 롤백되어 알림은 DRAFT로 남는다', async (): Promise<void> => {
    const { alarmRepository, useCase }: Fixture = await fixture(
      [bulkDraft()],
      new InMemoryDeliveryRepositoryAdapter(),
      new FailingExpansionJobRepository(),
    );

    await expect(useCase.execute(alarmId(ALARM_ID))).rejects.toThrow(
      'expansion job storage is unavailable',
    );
    expect(await storedStatus(alarmRepository)).toBe('DRAFT');
  });

  it('UC-05 긴급 알림의 Delivery 생성이 실패해도 전체가 롤백되어 알림은 DRAFT로 남는다', async (): Promise<void> => {
    const { alarmRepository, useCase }: Fixture = await fixture(
      [urgentDraft()],
      new FailingDeliveryRepository(),
    );

    await expect(useCase.execute(alarmId(ALARM_ID))).rejects.toThrow(
      'delivery storage is unavailable',
    );
    expect(await storedStatus(alarmRepository)).toBe('DRAFT');
  });

  it('UC-05 Delivery를 일부만 저장한 뒤 실패해도 저장한 Delivery까지 롤백된다', async (): Promise<void> => {
    const deliveryRepository: PartiallySavingDeliveryRepository =
      new PartiallySavingDeliveryRepository();
    const { alarmRepository, useCase }: Fixture = await fixture(
      [urgentDraft()],
      deliveryRepository,
    );

    await expect(useCase.execute(alarmId(ALARM_ID))).rejects.toThrow(
      'delivery storage failed midway',
    );
    expect(await storedStatus(alarmRepository)).toBe('DRAFT');
    expect(await deliveryRepository.findByAlarmId(alarmId(ALARM_ID))).toEqual([]);
  });

  it('UC-03 같은 알림의 발송 시작이 동시에 두 번 들어오면 하나만 성공하고 Delivery는 한 번만 만들어진다', async (): Promise<void> => {
    const { deliveryRepository, useCase }: Fixture = await fixture([urgentDraft()]);

    const results: ReadonlyArray<StartDispatchResult> = await Promise.all([
      useCase.execute(alarmId(ALARM_ID)),
      useCase.execute(alarmId(ALARM_ID)),
    ]);

    expect(results.map((result: StartDispatchResult): string => result.kind)).toEqual([
      'dispatched',
      'conflict',
    ]);
    expect(await deliveryRepository.findByAlarmId(alarmId(ALARM_ID))).toHaveLength(2);
  });

  it('UC-03 DRAFT가 아닌 알림은 상태 충돌을 반환하고 Delivery나 확장 작업을 만들지 않는다', async (): Promise<void> => {
    const { deliveryRepository, expansionJobRepository, useCase }: Fixture = await fixture([
      urgentDraft(),
    ]);
    await useCase.execute(alarmId(ALARM_ID));

    const second: StartDispatchResult = await useCase.execute(alarmId(ALARM_ID));

    expect(second).toEqual({
      kind: 'conflict',
      error: { code: 'ALARM_STATE_CONFLICT', status: 'DISPATCHING', action: 'dispatch' },
    });
    expect(await deliveryRepository.findByAlarmId(alarmId(ALARM_ID))).toHaveLength(2);
    expect(await expansionJobRepository.findByAlarmId(alarmId(ALARM_ID))).toEqual({
      kind: 'missing',
    });
  });
});
