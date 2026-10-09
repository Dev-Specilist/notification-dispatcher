import { describe, expect, expectTypeOf, it } from 'vitest';
import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import {
  AlarmCompletion,
  AlarmCreation,
  AlarmDraft,
  AlarmId,
  AlarmKind,
  AlarmSnapshot,
  AlarmStatus,
  AlarmTransition,
  CompletionEvidence,
  DeliveryCount,
  AllUsersTarget,
  ExplicitTarget,
} from '@/modules/notification/domain/alarm/alarm.type';
import { KindAssertion, KindMember } from '@/shared/testing/kind.assertion';

type RecipientCountCase = Readonly<[string, number]>;

type StatusCase = Readonly<[AlarmStatus, () => Alarm]>;

type EvidenceCase = Readonly<[string, CompletionEvidence]>;

type InvalidCountCase = Readonly<[string, number]>;

interface BulkWithExplicitTarget extends Omit<AlarmSnapshot, 'kind' | 'target'> {
  readonly kind: 'BULK';
  readonly target: ExplicitTarget;
}

interface UrgentWithAllUsersTarget extends Omit<AlarmSnapshot, 'kind' | 'target'> {
  readonly kind: 'URGENT';
  readonly target: AllUsersTarget;
}

type StatusBuildCase = Readonly<[string, () => Alarm]>;

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

const DISPATCHED_ISO: string = '2026-10-07T09:05:00.000Z';
const LATER_ISO: string = '2026-10-07T09:30:00.000Z';

const deliveryCount = (value: number): DeliveryCount => {
  if (!AlarmPredicates.isDeliveryCount(value)) {
    throw new Error(`test fixture ${value} is not a valid DeliveryCount`);
  }
  return value;
};

const SETTLED: CompletionEvidence = {
  expansionCompleted: true,
  unsettledDeliveries: deliveryCount(0),
};

const created = (creation: AlarmCreation): Alarm => {
  KindAssertion.assertKind(creation, 'created');
  const { alarm }: KindMember<AlarmCreation, 'created'> = creation;
  return alarm;
};

const transitioned = (result: AlarmTransition | AlarmCompletion): Alarm => {
  KindAssertion.assertKind(result, 'transitioned');
  const { alarm }: KindMember<AlarmTransition | AlarmCompletion, 'transitioned'> = result;
  return alarm;
};

const bulkDraft = (): Alarm =>
  created(Alarm.create(alarmId(), draft('BULK', []), new Date(NOW_ISO)));

const dispatching = (): Alarm => transitioned(bulkDraft().startDispatch(new Date(DISPATCHED_ISO)));

const completed = (): Alarm => transitioned(dispatching().complete(SETTLED, new Date(LATER_ISO)));

const cancelledFromDraft = (): Alarm => transitioned(bulkDraft().cancel(new Date(LATER_ISO)));

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
    const recipientIdsWithDuplicate: ReadonlyArray<string> = [...recipientIds(100), 'u_000001'];

    const alarm: Alarm = created(
      Alarm.create(alarmId(), draft('URGENT', recipientIdsWithDuplicate), NOW),
    );

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

  it('ALM-04 긴급 수신자 수 범위는 외부에서 바꿀 수 없어 101명 긴급 알림은 계속 거부된다', () => {
    const range: object = Reflect.get(Alarm, 'URGENT_RECIPIENT_RANGE');

    expect(() => Object.assign(range, { max: 101 })).toThrow(TypeError);
    expect(Alarm.create(alarmId(), draft('URGENT', recipientIds(101)), NOW)).toEqual({
      kind: 'rejected',
      error: { code: 'URGENT_RECIPIENTS_OUT_OF_RANGE', count: 101, min: 1, max: 100 },
    });
  });

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

  it('ALM-06 DRAFT 알림 / 발송을 시작한다 → DISPATCHING이 되고 시작 시각이 기록된다', () => {
    const alarm: Alarm = dispatching();

    expect(alarm.snapshot().state).toEqual({
      status: 'DISPATCHING',
      dispatchedAt: new Date(DISPATCHED_ISO),
    });
  });

  it('ALM-06 발송을 시작해도 원래 DRAFT 알림 객체는 바뀌지 않는다', () => {
    const draftAlarm: Alarm = bulkDraft();

    transitioned(draftAlarm.startDispatch(new Date(DISPATCHED_ISO)));

    expect(draftAlarm.snapshot().state).toEqual({ status: 'DRAFT' });
  });

  it.each<StatusCase>([
    ['DISPATCHING', (): Alarm => dispatching()],
    ['COMPLETED', (): Alarm => completed()],
    ['CANCELLED', (): Alarm => cancelledFromDraft()],
  ])(
    'ALM-07 %s 알림 / 발송을 시작한다 → 상태 충돌로 거부되고 상태는 바뀌지 않는다',
    (status: AlarmStatus, build: () => Alarm) => {
      const alarm: Alarm = build();
      const before: AlarmSnapshot = alarm.snapshot();

      expect(alarm.startDispatch(new Date(LATER_ISO))).toEqual({
        kind: 'conflict',
        error: { code: 'ALARM_STATE_CONFLICT', status, action: 'dispatch' },
      });
      expect(alarm.snapshot()).toEqual(before);
    },
  );

  it('ALM-08 DRAFT 알림 / 취소한다 → CANCELLED가 되고 발송한 적이 없음이 기록된다', () => {
    expect(cancelledFromDraft().snapshot().state).toEqual({
      status: 'CANCELLED',
      cancelledAt: new Date(LATER_ISO),
      dispatch: { kind: 'NEVER' },
    });
  });

  it('ALM-08 DISPATCHING 알림 / 취소한다 → CANCELLED가 되고 발송 시작 시각이 함께 남는다', () => {
    const alarm: Alarm = transitioned(dispatching().cancel(new Date(LATER_ISO)));

    expect(alarm.snapshot().state).toEqual({
      status: 'CANCELLED',
      cancelledAt: new Date(LATER_ISO),
      dispatch: { kind: 'STARTED', at: new Date(DISPATCHED_ISO) },
    });
  });

  it.each<StatusCase>([
    ['COMPLETED', (): Alarm => completed()],
    ['CANCELLED', (): Alarm => cancelledFromDraft()],
  ])(
    'ALM-09 %s 알림 / 취소한다 → 상태 충돌로 거부된다',
    (status: AlarmStatus, build: () => Alarm) => {
      expect(build().cancel(new Date(LATER_ISO))).toEqual({
        kind: 'conflict',
        error: { code: 'ALARM_STATE_CONFLICT', status, action: 'cancel' },
      });
    },
  );

  it('ALM-10 DISPATCHING 알림 / 확장 완료이고 미종결 Delivery가 0건이라는 판정 근거를 받는다 → COMPLETED가 된다', () => {
    expect(completed().snapshot().state).toEqual({
      status: 'COMPLETED',
      dispatchedAt: new Date(DISPATCHED_ISO),
      completedAt: new Date(LATER_ISO),
    });
  });

  it.each<EvidenceCase>([
    ['확장 미완료', { expansionCompleted: false, unsettledDeliveries: deliveryCount(0) }],
    ['미종결 Delivery 3건', { expansionCompleted: true, unsettledDeliveries: deliveryCount(3) }],
  ])(
    'ALM-11 DISPATCHING 알림 / %s라는 판정 근거를 받는다 → DISPATCHING을 유지한다',
    (_label: string, evidence: CompletionEvidence) => {
      const alarm: Alarm = dispatching();

      const completion: AlarmCompletion = alarm.complete(evidence, new Date(LATER_ISO));

      expect(completion.kind).toBe('unchanged');
      expect(alarm.snapshot().state.status).toBe('DISPATCHING');
    },
  );

  it.each<StatusCase>([
    ['DRAFT', (): Alarm => bulkDraft()],
    ['COMPLETED', (): Alarm => completed()],
    ['CANCELLED', (): Alarm => cancelledFromDraft()],
  ])(
    'ALM-12 %s 알림 / 완료를 판정한다 → 상태 충돌로 거부된다',
    (status: AlarmStatus, build: () => Alarm) => {
      expect(build().complete(SETTLED, new Date(LATER_ISO))).toEqual({
        kind: 'conflict',
        error: { code: 'ALARM_STATE_CONFLICT', status, action: 'complete' },
      });
    },
  );

  it.each<InvalidCountCase>([
    ['음수', -1],
    ['NaN', Number.NaN],
    ['소수', 1.5],
    ['무한대', Number.POSITIVE_INFINITY],
  ])(
    '미종결 Delivery 건수가 %s(%s)이면 유효한 건수로 인정하지 않는다',
    (_label: string, value: number) => {
      expect(AlarmPredicates.isDeliveryCount(value)).toBe(false);
    },
  );

  it('미종결 Delivery 건수는 0 이상의 정수만 유효하다', () => {
    expect(
      [0, 1, 100_000].map((value: number): boolean => AlarmPredicates.isDeliveryCount(value)),
    ).toEqual([true, true, true]);
  });

  it('검증하지 않은 number는 완료 판정 근거의 건수로 넘길 수 없다', () => {
    expectTypeOf<number>().not.toExtend<DeliveryCount>();
    expectTypeOf<CompletionEvidence['unsettledDeliveries']>().toEqualTypeOf<DeliveryCount>();
  });

  it('상태 전이로 만든 snapshot의 시각을 바꿔도 알림 내부 상태는 바뀌지 않는다', () => {
    const alarm: Alarm = transitioned(dispatching().cancel(new Date(LATER_ISO)));
    const { state }: AlarmSnapshot = alarm.snapshot();

    if (state.status === 'CANCELLED' && state.dispatch.kind === 'STARTED') {
      state.cancelledAt.setUTCFullYear(1990);
      state.dispatch.at.setUTCFullYear(1990);
    }

    expect(alarm.snapshot().state).toEqual({
      status: 'CANCELLED',
      cancelledAt: new Date(LATER_ISO),
      dispatch: { kind: 'STARTED', at: new Date(DISPATCHED_ISO) },
    });
  });

  it.each<StatusBuildCase>([
    ['DRAFT', bulkDraft],
    ['DISPATCHING', dispatching],
    ['COMPLETED', completed],
    ['CANCELLED', cancelledFromDraft],
  ])(
    '저장된 %s 알림의 snapshot으로 복원하면 같은 snapshot을 가진 알림이 된다',
    (_status: string, build: () => Alarm) => {
      const original: Alarm = build();

      expect(Alarm.reconstitute(original.snapshot()).snapshot()).toEqual(original.snapshot());
    },
  );

  it('복원에 넘긴 snapshot을 나중에 바꿔도 복원한 알림은 바뀌지 않는다', () => {
    const snapshot: AlarmSnapshot = dispatching().snapshot();
    const alarm: Alarm = Alarm.reconstitute(snapshot);

    snapshot.createdAt.setUTCFullYear(1990);
    if (snapshot.state.status === 'DISPATCHING') {
      snapshot.state.dispatchedAt.setUTCFullYear(1990);
    }

    expect(alarm.snapshot()).toMatchObject({
      createdAt: NOW,
      state: { status: 'DISPATCHING', dispatchedAt: new Date(DISPATCHED_ISO) },
    });
  });

  it('복원한 알림도 상태 규칙을 그대로 따른다', () => {
    const alarm: Alarm = Alarm.reconstitute(completed().snapshot());

    expect(alarm.cancel(new Date(LATER_ISO))).toEqual({
      kind: 'conflict',
      error: { code: 'ALARM_STATE_CONFLICT', status: 'COMPLETED', action: 'cancel' },
    });
  });

  it.each<StatusBuildCase>([
    ['DRAFT', bulkDraft],
    ['DISPATCHING', dispatching],
    ['COMPLETED', completed],
  ])('UC-08 %s 알림은 취소된 알림으로 판별되지 않는다', (_status: string, build: () => Alarm) => {
    expect(build().isCancelled()).toBe(false);
  });

  it.each<StatusBuildCase>([
    ['DRAFT', cancelledFromDraft],
    ['DISPATCHING', (): Alarm => transitioned(dispatching().cancel(new Date(LATER_ISO)))],
  ])(
    'UC-08 %s에서 취소된 알림은 취소된 알림으로 판별된다',
    (_status: string, build: () => Alarm) => {
      expect(build().isCancelled()).toBe(true);
    },
  );

  it('UC-12 대량 알림은 완료 전에 수신자 확장이 끝나야 하고 긴급 알림은 확장이 필요 없다', () => {
    const urgent: Alarm = created(Alarm.create(alarmId(), draft('URGENT', recipientIds(1)), NOW));

    expect(bulkDraft().requiresExpansion()).toBe(true);
    expect(urgent.requiresExpansion()).toBe(false);
  });
});
