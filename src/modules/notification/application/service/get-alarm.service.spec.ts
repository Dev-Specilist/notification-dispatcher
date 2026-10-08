import { describe, expect, it } from 'vitest';
import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import {
  AlarmCreated,
  AlarmCreation,
  AlarmId,
} from '@/modules/notification/domain/alarm/alarm.type';
import { TransactionRepositories } from '@/modules/notification/application/port/out/unit-of-work.type';
import {
  AlarmFoundResult,
  AlarmResult,
} from '@/modules/notification/application/port/in/alarm-result.type';
import { AlarmView } from '@/modules/notification/application/port/in/alarm-view.type';
import { AlarmViewMapper } from '@/modules/notification/application/service/alarm-view.mapper';
import { GetAlarmService } from '@/modules/notification/application/service/get-alarm.service';
import { InMemoryAlarmRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-alarm-repository.adapter';
import { InMemoryDeliveryRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-delivery-repository.adapter';
import { InMemoryExpansionJobRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-expansion-job-repository.adapter';
import { InMemoryUnitOfWorkAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-unit-of-work.adapter';

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

interface Fixture {
  readonly alarmRepository: InMemoryAlarmRepositoryAdapter;
  readonly unitOfWork: InMemoryUnitOfWorkAdapter;
  readonly query: GetAlarmService;
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

const found = (result: AlarmResult): AlarmView => {
  if (result.kind !== 'found') {
    throw new Error(`expected found but got ${result.kind}`);
  }
  const { alarm }: AlarmFoundResult = result;
  return alarm;
};

const fixture = (): Fixture => {
  const alarmRepository: InMemoryAlarmRepositoryAdapter = new InMemoryAlarmRepositoryAdapter();
  const unitOfWork: InMemoryUnitOfWorkAdapter = new InMemoryUnitOfWorkAdapter({
    alarmRepository,
    deliveryRepository: new InMemoryDeliveryRepositoryAdapter(),
    expansionJobRepository: new InMemoryExpansionJobRepositoryAdapter(),
  });
  return { alarmRepository, unitOfWork, query: new GetAlarmService(unitOfWork) };
};

describe('GetAlarmService', () => {
  it('UC-02 저장된 알림 id로 조회하면 그 알림을 반환한다', async (): Promise<void> => {
    const { alarmRepository, query }: Fixture = fixture();
    const alarm: Alarm = storedAlarm();
    await alarmRepository.save(alarm);

    const result: AlarmResult = await query.execute(alarmId(STORED_ID));

    expect(found(result)).toEqual(AlarmViewMapper.toView(alarm));
  });

  it('UC-02 없는 알림 id / 조회·발송 시작·취소 → 알림 없음 오류가 난다', async (): Promise<void> => {
    const { alarmRepository, query }: Fixture = fixture();
    await alarmRepository.save(storedAlarm());

    const result: AlarmResult = await query.execute(alarmId(MISSING_ID));

    expect(result).toEqual({
      kind: 'not-found',
      error: { code: 'ALARM_NOT_FOUND', alarmId: MISSING_ID },
    });
  });

  it('UC-02 커밋되지 않은 다른 트랜잭션의 저장은 조회되지 않는다', async (): Promise<void> => {
    const { unitOfWork, query }: Fixture = fixture();
    const uncommittedSaved: Gate = createGate();
    const failureReleased: Gate = createGate();
    const failing: Promise<void> = unitOfWork.run(
      async ({ alarmRepository }: TransactionRepositories): Promise<void> => {
        await alarmRepository.save(storedAlarm());
        uncommittedSaved.open();
        await failureReleased.opened;
        throw new Error('other transaction failed');
      },
    );
    await uncommittedSaved.opened;

    const result: Promise<AlarmResult> = query.execute(alarmId(STORED_ID));
    failureReleased.open();

    await expect(failing).rejects.toThrow('other transaction failed');
    expect((await result).kind).toBe('not-found');
  });
});
