import { describe, expect, it } from 'vitest';
import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { AlarmCreation, AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { AlarmResult } from '@/modules/notification/application/use-case/alarm-result.type';
import { GetAlarmQuery } from '@/modules/notification/application/use-case/get-alarm.query';
import { InMemoryAlarmRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-alarm-repository.adapter';

const STORED_ID: string = '0b6c1b4e-9a37-4c2a-8d6a-2f6b2d7f1a10';
const MISSING_ID: string = '7d3f1e2a-4b5c-4d6e-8f70-1a2b3c4d5e6f';

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
  return creation.alarm;
};

const found = (result: AlarmResult): Alarm => {
  if (result.kind !== 'found') {
    throw new Error(`expected found but got ${result.kind}`);
  }
  return result.alarm;
};

describe('GetAlarmQuery', () => {
  it('UC-02 저장된 알림 id로 조회하면 그 알림을 반환한다', async (): Promise<void> => {
    const alarmRepository: InMemoryAlarmRepositoryAdapter = new InMemoryAlarmRepositoryAdapter();
    const alarm: Alarm = storedAlarm();
    await alarmRepository.save(alarm);

    const result: AlarmResult = await new GetAlarmQuery(alarmRepository).execute(
      alarmId(STORED_ID),
    );

    expect(found(result).snapshot()).toEqual(alarm.snapshot());
  });

  it('UC-02 없는 알림 id / 조회·발송 시작·취소 → 알림 없음 오류가 난다', async (): Promise<void> => {
    const alarmRepository: InMemoryAlarmRepositoryAdapter = new InMemoryAlarmRepositoryAdapter();
    await alarmRepository.save(storedAlarm());

    const result: AlarmResult = await new GetAlarmQuery(alarmRepository).execute(
      alarmId(MISSING_ID),
    );

    expect(result).toEqual({
      kind: 'not-found',
      error: { code: 'ALARM_NOT_FOUND', alarmId: MISSING_ID },
    });
  });
});
