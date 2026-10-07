import { describe, expect, it } from 'vitest';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmCreation, AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { AlarmRepositoryPort } from '@/modules/notification/application/port/alarm-repository.port';
import { ClockPort } from '@/modules/notification/application/port/clock.port';
import { IdGeneratorPort } from '@/modules/notification/application/port/id-generator.port';
import { AlarmLookup } from '@/modules/notification/application/port/alarm-repository.type';
import { CreateAlarmUseCase } from '@/modules/notification/application/use-case/create-alarm.use-case';
import { InMemoryAlarmRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-alarm-repository.adapter';

const NOW_ISO: string = '2026-10-07T09:00:00.000Z';

const alarmId = (): AlarmId => {
  const value: string = '0b6c1b4e-9a37-4c2a-8d6a-2f6b2d7f1a10';
  if (!AlarmPredicates.isAlarmId(value)) {
    throw new Error('test fixture is not a valid AlarmId');
  }
  return value;
};

class FixedClock extends ClockPort {
  now(): Date {
    return new Date(NOW_ISO);
  }
}

class FixedIdGenerator extends IdGeneratorPort {
  alarmId(): AlarmId {
    return alarmId();
  }
}

class FailingAlarmRepository extends AlarmRepositoryPort {
  save(): Promise<void> {
    return Promise.reject(new Error('alarm storage is unavailable'));
  }

  findById(): Promise<AlarmLookup> {
    return Promise.resolve({ kind: 'missing' });
  }
}

const created = (creation: AlarmCreation): Alarm => {
  if (creation.kind !== 'created') {
    throw new Error(`expected created but got ${creation.error.code}`);
  }
  return creation.alarm;
};

const found = (lookup: AlarmLookup): Alarm => {
  if (lookup.kind !== 'found') {
    throw new Error('expected the alarm to be stored');
  }
  return lookup.alarm;
};

interface Fixture {
  readonly alarmRepository: InMemoryAlarmRepositoryAdapter;
  readonly useCase: CreateAlarmUseCase;
}

const fixture = (): Fixture => {
  const alarmRepository: InMemoryAlarmRepositoryAdapter = new InMemoryAlarmRepositoryAdapter();
  return {
    alarmRepository,
    useCase: new CreateAlarmUseCase(alarmRepository, new FixedIdGenerator(), new FixedClock()),
  };
};

describe('CreateAlarmUseCase', () => {
  it('UC-01 유효한 요청 / 알림 생성 유스케이스 → 저장소에 DRAFT 알림이 저장되고 반환된다', async (): Promise<void> => {
    const { alarmRepository, useCase }: Fixture = fixture();

    const alarm: Alarm = created(
      await useCase.execute({
        title: '추석 이벤트',
        body: '연휴 쿠폰이 도착했어요',
        kind: 'BULK',
        recipientIds: [],
      }),
    );
    const stored: Alarm = found(await alarmRepository.findById(alarmId()));

    expect(stored.snapshot()).toEqual(alarm.snapshot());
    expect(stored.snapshot()).toMatchObject({
      id: alarmId(),
      state: { status: 'DRAFT' },
      createdAt: new Date(NOW_ISO),
    });
  });

  it('UC-01 저장에 실패하면 생성 성공을 반환하지 않고 저장 오류를 그대로 전달한다', async (): Promise<void> => {
    const useCase: CreateAlarmUseCase = new CreateAlarmUseCase(
      new FailingAlarmRepository(),
      new FixedIdGenerator(),
      new FixedClock(),
    );

    await expect(
      useCase.execute({ title: '추석 이벤트', body: '본문', kind: 'BULK', recipientIds: [] }),
    ).rejects.toThrow('alarm storage is unavailable');
  });

  it('UC-01 검증에 실패한 요청은 저장하지 않고 거부 사유를 반환한다', async (): Promise<void> => {
    const { alarmRepository, useCase }: Fixture = fixture();

    const creation: AlarmCreation = await useCase.execute({
      title: ' ',
      body: '본문',
      kind: 'BULK',
      recipientIds: [],
    });

    expect(creation).toEqual({ kind: 'rejected', error: { code: 'EMPTY_TITLE' } });
    expect(await alarmRepository.findById(alarmId())).toEqual({ kind: 'missing' });
  });
});
