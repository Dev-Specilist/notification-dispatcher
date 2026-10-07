import { describe, expect, expectTypeOf, it } from 'vitest';
import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import {
  AlarmCreation,
  AlarmDraft,
  AlarmId,
  AlarmKind,
  AlarmSnapshot,
  AllUsersTarget,
  ExplicitTarget,
} from '@/modules/notification/domain/alarm/alarm.type';

type RecipientCountCase = Readonly<[string, number]>;

interface BulkWithExplicitTarget extends Omit<AlarmSnapshot, 'kind' | 'target'> {
  readonly kind: 'BULK';
  readonly target: ExplicitTarget;
}

interface UrgentWithAllUsersTarget extends Omit<AlarmSnapshot, 'kind' | 'target'> {
  readonly kind: 'URGENT';
  readonly target: AllUsersTarget;
}

const ALARM_ID: string = '0b6c1b4e-9a37-4c2a-8d6a-2f6b2d7f1a10';
const NOW_ISO: string = '2026-10-07T09:00:00.000Z';
const NOW: Date = new Date(NOW_ISO);

const alarmId = (): AlarmId => {
  if (!AlarmPredicates.isAlarmId(ALARM_ID)) {
    throw new Error('test fixture is not a valid AlarmId');
  }
  return ALARM_ID;
};

const recipientIds = (count: number): ReadonlyArray<string> =>
  Array.from(
    { length: count },
    (_: number, index: number): string => `u_${String(index + 1).padStart(6, '0')}`,
  );

const draft = (
  kind: AlarmKind,
  ids: ReadonlyArray<string>,
  title: string = '추석 이벤트 안내',
  body: string = '메시지 본문',
): AlarmDraft => ({ title, body, kind, recipientIds: ids });

const created = (creation: AlarmCreation): Alarm => {
  if (creation.kind !== 'created') {
    throw new Error(`expected created but got ${creation.error.code}`);
  }
  return creation.alarm;
};

describe('Alarm', () => {
  it('ALM-01 제목과 본문이 있는 대량 알림 요청 / 알림을 만든다 → DRAFT 상태이고 수신 대상은 전체 사용자다', () => {
    const alarm: Alarm = created(Alarm.create(alarmId(), draft('BULK', []), NOW));

    expect(alarm.snapshot()).toEqual({
      id: ALARM_ID,
      title: '추석 이벤트 안내',
      body: '메시지 본문',
      kind: 'BULK',
      target: { kind: 'ALL_USERS' },
      state: { status: 'DRAFT' },
      createdAt: NOW,
    });
  });

  it.each(['', '   '])(
    'ALM-02 제목이 비어 있다("%s") / 알림을 만든다 → 생성이 거부된다',
    (title: string) => {
      expect(Alarm.create(alarmId(), draft('BULK', [], title), NOW)).toEqual({
        kind: 'rejected',
        error: { code: 'EMPTY_TITLE' },
      });
    },
  );

  it('ALM-02 본문이 비어 있다 / 알림을 만든다 → 생성이 거부된다', () => {
    expect(Alarm.create(alarmId(), draft('BULK', [], '제목', ' '), NOW)).toEqual({
      kind: 'rejected',
      error: { code: 'EMPTY_BODY' },
    });
  });

  it('ALM-03 수신자 1~100명을 지정한 긴급 알림 요청 / 알림을 만든다 → DRAFT 상태이고 지정한 수신자를 중복 없이 가진다', () => {
    const alarm: Alarm = created(
      Alarm.create(alarmId(), draft('URGENT', ['u_000002', 'u_000001', 'u_000002']), NOW),
    );

    expect(alarm.snapshot()).toMatchObject({
      kind: 'URGENT',
      target: { kind: 'EXPLICIT', recipientIds: ['u_000002', 'u_000001'] },
      state: { status: 'DRAFT' },
    });
  });

  it('ALM-03 긴급 알림은 중복을 제거한 뒤 정확히 100명까지 허용한다', () => {
    const ids: ReadonlyArray<string> = [...recipientIds(100), 'u_000001'];

    const alarm: Alarm = created(Alarm.create(alarmId(), draft('URGENT', ids), NOW));

    expect(alarm.snapshot().target).toEqual({ kind: 'EXPLICIT', recipientIds: recipientIds(100) });
  });

  it.each<RecipientCountCase>([
    ['0명', 0],
    ['101명', 101],
  ])(
    'ALM-04 수신자가 %s인 긴급 알림 요청 / 알림을 만든다 → 생성이 거부된다',
    (_label: string, count: number) => {
      expect(Alarm.create(alarmId(), draft('URGENT', recipientIds(count)), NOW)).toEqual({
        kind: 'rejected',
        error: { code: 'URGENT_RECIPIENTS_OUT_OF_RANGE', count, min: 1, max: 100 },
      });
    },
  );

  it('ALM-04 형식이 잘못된 수신자 id가 섞인 긴급 알림 요청 / 알림을 만든다 → 생성이 거부된다', () => {
    expect(Alarm.create(alarmId(), draft('URGENT', ['u_000001', ' ']), NOW)).toEqual({
      kind: 'rejected',
      error: { code: 'INVALID_RECIPIENT_ID', value: ' ' },
    });
  });

  it('ALM-05 대량 알림에 수신자를 지정했다 / 알림을 만든다 → 생성이 거부된다 (대량 알림은 전체 사용자 대상)', () => {
    expect(Alarm.create(alarmId(), draft('BULK', ['u_000001']), NOW)).toEqual({
      kind: 'rejected',
      error: { code: 'BULK_RECIPIENTS_NOT_ALLOWED' },
    });
  });

  it('생성에 넘긴 Date를 나중에 바꿔도 알림의 생성 시각은 바뀌지 않는다', () => {
    const now: Date = new Date(NOW_ISO);
    const alarm: Alarm = created(Alarm.create(alarmId(), draft('BULK', []), now));

    now.setUTCFullYear(2000);

    expect(alarm.snapshot().createdAt.toISOString()).toBe(NOW_ISO);
  });

  it('snapshot으로 받은 Date를 바꿔도 알림 내부 상태는 바뀌지 않는다', () => {
    const alarm: Alarm = created(Alarm.create(alarmId(), draft('BULK', []), new Date(NOW_ISO)));

    alarm.snapshot().createdAt.setUTCFullYear(1990);

    expect(alarm.snapshot().createdAt.toISOString()).toBe(NOW_ISO);
  });

  it('snapshot으로 받은 수신자 배열을 바꿔도 알림 내부 수신자는 바뀌지 않는다', () => {
    const alarm: Alarm = created(
      Alarm.create(alarmId(), draft('URGENT', ['u_000001']), new Date(NOW_ISO)),
    );
    const { target }: AlarmSnapshot = alarm.snapshot();

    if (target.kind === 'EXPLICIT' && Array.isArray(target.recipientIds)) {
      target.recipientIds.push(' ');
    }

    expect(alarm.snapshot().target).toEqual({ kind: 'EXPLICIT', recipientIds: ['u_000001'] });
  });

  it('알림 종류와 수신 대상은 BULK·ALL_USERS 또는 URGENT·EXPLICIT 조합만 타입으로 허용한다', () => {
    expectTypeOf<BulkWithExplicitTarget>().not.toExtend<AlarmSnapshot>();
    expectTypeOf<UrgentWithAllUsersTarget>().not.toExtend<AlarmSnapshot>();
  });

  it.todo('ALM-06 DRAFT 알림 / 발송을 시작한다 → DISPATCHING이 되고 시작 시각이 기록된다');
  it.todo(
    'ALM-07 DISPATCHING·COMPLETED·CANCELLED 알림 / 발송을 시작한다 → 상태 충돌로 거부되고 상태는 바뀌지 않는다',
  );
  it.todo('ALM-08 DRAFT 또는 DISPATCHING 알림 / 취소한다 → CANCELLED가 되고 취소 시각이 기록된다');
  it.todo('ALM-09 COMPLETED·CANCELLED 알림 / 취소한다 → 상태 충돌로 거부된다');
  it.todo(
    'ALM-10 DISPATCHING 알림 / 확장 완료이고 미종결 Delivery가 0건이라는 판정 근거를 받는다 → COMPLETED가 된다',
  );
  it.todo(
    'ALM-11 DISPATCHING 알림 / 확장 미완료이거나 미종결 Delivery가 남아 있다는 판정 근거를 받는다 → DISPATCHING을 유지한다',
  );
});
