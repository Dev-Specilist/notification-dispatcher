import { describe, expect, it } from 'vitest';
import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { AlarmDraft, AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import { DeliveryId } from '@/modules/notification/domain/delivery/delivery.type';
import {
  AlarmFound,
  AlarmLookup,
} from '@/modules/notification/application/port/out/alarm-repository.type';
import {
  AlarmCreatedResult,
  CreateAlarmResult,
} from '@/modules/notification/application/port/in/create-alarm.type';
import { AlarmView } from '@/modules/notification/application/port/in/alarm-view.type';
import { AlarmViewMapper } from '@/modules/notification/application/service/alarm-view.mapper';
import { ClockPort } from '@/modules/notification/application/port/out/clock.port';
import { IdGeneratorPort } from '@/modules/notification/application/port/out/id-generator.port';
import { CreateAlarmService } from '@/modules/notification/application/service/create-alarm.service';
import { InMemoryAlarmRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-alarm-repository.adapter';
import { InMemoryDeliveryRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-delivery-repository.adapter';
import { InMemoryExpansionJobRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-expansion-job-repository.adapter';
import { InMemoryUnitOfWorkAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-unit-of-work.adapter';

const NOW_ISO: string = '2026-10-07T09:00:00.000Z';

const BULK_DRAFT: AlarmDraft = {
  title: '추석 이벤트',
  body: '연휴 쿠폰이 도착했어요',
  kind: 'BULK',
  recipientIds: [],
};

const alarmId = (): AlarmId => {
  const value: string = '0b6c1b4e-9a37-4c2a-8d6a-2f6b2d7f1a10';
  if (!AlarmPredicates.isAlarmId(value)) {
    throw new Error('test fixture is not a valid AlarmId');
  }
  return value;
};

class FixedClock implements ClockPort {
  now(): Date {
    return new Date(NOW_ISO);
  }
}

class FixedIdGenerator implements IdGeneratorPort {
  alarmId(): AlarmId {
    return alarmId();
  }

  deliveryId(): DeliveryId {
    const value: string = '5f1d2a8c-3b4e-4c6d-9e7f-8a9b0c1d2e3f';
    if (!DeliveryPredicates.isDeliveryId(value)) {
      throw new Error('test fixture is not a valid DeliveryId');
    }
    return value;
  }
}

class FailingAlarmRepository extends InMemoryAlarmRepositoryAdapter {
  override save(): Promise<void> {
    return Promise.reject(new Error('alarm storage is unavailable'));
  }
}

const created = (result: CreateAlarmResult): AlarmView => {
  if (result.kind !== 'created') {
    throw new Error(`expected created but got ${result.error.code}`);
  }
  const { alarm }: AlarmCreatedResult = result;
  return alarm;
};

const found = (lookup: AlarmLookup): Alarm => {
  if (lookup.kind !== 'found') {
    throw new Error('expected the alarm to be stored');
  }
  const { alarm }: AlarmFound = lookup;
  return alarm;
};

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

interface Fixture {
  readonly alarmRepository: InMemoryAlarmRepositoryAdapter;
  readonly unitOfWork: InMemoryUnitOfWorkAdapter;
  readonly service: CreateAlarmService;
}

const fixture = (
  alarmRepository: InMemoryAlarmRepositoryAdapter = new InMemoryAlarmRepositoryAdapter(),
): Fixture => {
  const unitOfWork: InMemoryUnitOfWorkAdapter = new InMemoryUnitOfWorkAdapter({
    alarmRepository,
    deliveryRepository: new InMemoryDeliveryRepositoryAdapter(),
    expansionJobRepository: new InMemoryExpansionJobRepositoryAdapter(),
  });
  return {
    alarmRepository,
    unitOfWork,
    service: new CreateAlarmService(unitOfWork, new FixedIdGenerator(), new FixedClock()),
  };
};

describe('CreateAlarmService', () => {
  it('UC-01 유효한 요청 / 알림 생성 유스케이스 → 저장소에 DRAFT 알림이 저장되고 반환된다', async (): Promise<void> => {
    const { alarmRepository, service }: Fixture = fixture();

    const view: AlarmView = created(await service.execute(BULK_DRAFT));
    const stored: Alarm = found(await alarmRepository.findById(alarmId()));

    expect(view).toEqual(AlarmViewMapper.toView(stored));
    expect(view).toMatchObject({
      id: alarmId(),
      state: { status: 'DRAFT' },
      createdAt: new Date(NOW_ISO),
    });
  });

  it('UC-01 저장에 실패하면 생성 성공을 반환하지 않고 저장 오류를 그대로 전달한다', async (): Promise<void> => {
    const { service }: Fixture = fixture(new FailingAlarmRepository());

    await expect(service.execute(BULK_DRAFT)).rejects.toThrow('alarm storage is unavailable');
  });

  it('UC-01 진행 중인 다른 트랜잭션이 실패해 롤백돼도 그사이 생성한 알림은 남는다', async (): Promise<void> => {
    const { alarmRepository, unitOfWork, service }: Fixture = fixture();
    const transactionStarted: Gate = createGate();
    const failureReleased: Gate = createGate();
    const failing: Promise<void> = unitOfWork.run(async (): Promise<void> => {
      transactionStarted.open();
      await failureReleased.opened;
      throw new Error('other transaction failed');
    });
    await transactionStarted.opened;

    const pending: Promise<CreateAlarmResult> = service.execute(BULK_DRAFT);
    failureReleased.open();

    await expect(failing).rejects.toThrow('other transaction failed');
    expect(created(await pending).id).toBe(alarmId());
    expect((await alarmRepository.findById(alarmId())).kind).toBe('found');
  });

  it('UC-01 검증에 실패한 요청은 저장하지 않고 거부 사유를 반환한다', async (): Promise<void> => {
    const { alarmRepository, service }: Fixture = fixture();

    const result: CreateAlarmResult = await service.execute({ ...BULK_DRAFT, title: ' ' });

    expect(result).toEqual({ kind: 'rejected', error: { code: 'EMPTY_TITLE' } });
    expect(await alarmRepository.findById(alarmId())).toEqual({ kind: 'missing' });
  });
});
