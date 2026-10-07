import { describe, expect, expectTypeOf, it } from 'vitest';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { AlarmId, RecipientId } from '@/modules/notification/domain/alarm/alarm.type';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import { DurationPredicates } from '@/shared/domain/duration.predicate';
import { DurationMs } from '@/shared/domain/duration.type';
import { RetryPolicy } from '@/modules/notification/domain/delivery/retry-policy';
import { RetryPolicyCreation } from '@/modules/notification/domain/delivery/retry-policy.type';
import {
  AttemptLimit,
  DeliveryId,
  DeliverySnapshot,
  DeliveryTransition,
  JitterRatio,
  LeaseToken,
  MessageId,
  PermanentFailureCode,
} from '@/modules/notification/domain/delivery/delivery.type';

type StatusBuildCase = Readonly<[string, () => Delivery]>;

type InvalidDurationCase = Readonly<[string, number]>;

type RetryStep = 'TRANSIENT' | 'RATE_LIMITED';

const T0_ISO: string = '2026-10-07T09:00:00.000Z';
const CLAIMED_ISO: string = '2026-10-07T09:00:01.000Z';
const STARTED_ISO: string = '2026-10-07T09:00:02.000Z';
const SETTLED_ISO: string = '2026-10-07T09:00:03.000Z';

const durationMs = (value: number): DurationMs => {
  if (!DurationPredicates.isDurationMs(value)) {
    throw new Error(`test fixture ${value} is not a valid DurationMs`);
  }
  return value;
};

const attemptLimit = (value: number): AttemptLimit => {
  if (!DeliveryPredicates.isAttemptLimit(value)) {
    throw new Error(`test fixture ${value} is not a valid AttemptLimit`);
  }
  return value;
};

const jitter = (value: number): JitterRatio => {
  if (!DeliveryPredicates.isJitterRatio(value)) {
    throw new Error(`test fixture ${value} is not a valid JitterRatio`);
  }
  return value;
};

const LEASE_MS: DurationMs = durationMs(60_000);
const MAX_REQUEST_MS: DurationMs = durationMs(10_000);
const RECONCILE_DELAY_MS: DurationMs = durationMs(35_000);
const LEASE_EXPIRED_ISO: string = '2026-10-07T09:01:01.000Z';

const retryPolicy = (maxAttempts: number): RetryPolicy => {
  const creation: RetryPolicyCreation = RetryPolicy.create({
    maxAttempts: attemptLimit(maxAttempts),
    baseDelayMs: durationMs(1_000),
    maxDelayMs: durationMs(8_000),
  });
  if (creation.kind !== 'created') {
    throw new Error(`test fixture policy is invalid: ${creation.error.code}`);
  }
  return creation.policy;
};

const at = (iso: string): Date => new Date(iso);

const deliveryId = (): DeliveryId => {
  const value: string = '5f1d2a8c-3b4e-4c6d-9e7f-8a9b0c1d2e3f';
  if (!DeliveryPredicates.isDeliveryId(value)) {
    throw new Error('test fixture is not a valid DeliveryId');
  }
  return value;
};

const alarmId = (): AlarmId => {
  const value: string = '0b6c1b4e-9a37-4c2a-8d6a-2f6b2d7f1a10';
  if (!AlarmPredicates.isAlarmId(value)) {
    throw new Error('test fixture is not a valid AlarmId');
  }
  return value;
};

const recipientId = (): RecipientId => {
  const value: string = 'u_000001';
  if (!AlarmPredicates.isRecipientId(value)) {
    throw new Error('test fixture is not a valid RecipientId');
  }
  return value;
};

const leaseToken = (suffix: string): LeaseToken => {
  const value: string = `9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c${suffix}`;
  if (!DeliveryPredicates.isLeaseToken(value)) {
    throw new Error('test fixture is not a valid LeaseToken');
  }
  return value;
};

const messageId = (): MessageId => {
  const value: string = 'm_1';
  if (!DeliveryPredicates.isMessageId(value)) {
    throw new Error('test fixture is not a valid MessageId');
  }
  return value;
};

const TOKEN_A: () => LeaseToken = (): LeaseToken => leaseToken('aa');
const TOKEN_B: () => LeaseToken = (): LeaseToken => leaseToken('bb');

const released = (result: DeliveryTransition): Delivery => {
  if (result.kind !== 'released') {
    throw new Error(`expected released but got ${result.kind}`);
  }
  return result.delivery;
};

const transitioned = (result: DeliveryTransition): Delivery => {
  if (result.kind !== 'transitioned') {
    throw new Error(`expected transitioned but got ${result.kind}`);
  }
  return result.delivery;
};

const pending = (): Delivery =>
  Delivery.create(
    { id: deliveryId(), alarmId: alarmId(), recipientId: recipientId(), priority: 'BULK' },
    at(T0_ISO),
  );

const claimed = (): Delivery => transitioned(pending().claim(TOKEN_A(), at(CLAIMED_ISO), LEASE_MS));

const started = (): Delivery =>
  transitioned(claimed().startRequest(TOKEN_A(), at(STARTED_ISO), MAX_REQUEST_MS));

const sent = (): Delivery =>
  transitioned(started().recordAccepted(TOKEN_A(), messageId(), at(SETTLED_ISO)));

const unknownAfterTimeout = (): Delivery =>
  transitioned(started().recordUnknown(TOKEN_A(), at(SETTLED_ISO), RECONCILE_DELAY_MS));

const failed = (): Delivery =>
  transitioned(started().recordPermanentFailure(TOKEN_A(), 'RECIPIENT_BLOCKED'));

describe('Delivery', () => {
  it('새 Delivery는 PENDING이고 시도 횟수는 0이다', () => {
    expect(pending().snapshot()).toEqual({
      id: deliveryId(),
      alarmId: alarmId(),
      recipientId: recipientId(),
      priority: 'BULK',
      attempts: 0,
      state: { status: 'PENDING' },
      createdAt: at(T0_ISO),
    });
  });

  it('DLV-01 PENDING Delivery / 워커가 claim한다 → IN_FLIGHT가 되고 새 leaseToken과 lease 만료 시각이 기록된다. 시도 횟수는 아직 늘지 않는다', () => {
    const { state, attempts }: DeliverySnapshot = claimed().snapshot();

    expect(attempts).toBe(0);
    expect(state).toEqual({
      status: 'IN_FLIGHT',
      lease: { token: TOKEN_A(), expiresAt: new Date(at(CLAIMED_ISO).getTime() + LEASE_MS) },
      request: { kind: 'NOT_STARTED' },
    });
  });

  it('DLV-01 이미 IN_FLIGHT인 Delivery는 다시 claim할 수 없다', () => {
    expect(claimed().claim(TOKEN_B(), at(STARTED_ISO), LEASE_MS)).toEqual({
      kind: 'rejected',
      reason: 'NOT_CLAIMABLE',
    });
  });

  it('DLV-02 IN_FLIGHT Delivery / 실제 HTTP 요청을 시작한다 → 시도 횟수가 1 늘고 요청 시작 시각이 기록된다', () => {
    const { state, attempts }: DeliverySnapshot = started().snapshot();

    expect(attempts).toBe(1);
    expect(state).toMatchObject({
      status: 'IN_FLIGHT',
      request: { kind: 'STARTED', at: at(STARTED_ISO) },
    });
  });

  it('DLV-03 IN_FLIGHT Delivery / 202 응답을 받는다 → SENT가 되고 messageId가 기록된다', () => {
    expect(sent().snapshot().state).toEqual({
      status: 'SENT',
      messageId: messageId(),
      sentAt: at(SETTLED_ISO),
      duplicateCount: 0,
    });
  });

  it.each<PermanentFailureCode>(['RECIPIENT_BLOCKED', 'UNKNOWN_RECIPIENT', 'INVALID_REQUEST'])(
    'DLV-04 IN_FLIGHT Delivery / 400 %s를 받는다 → 재시도 없이 FAILED가 되고 사유 코드가 기록된다',
    (code: PermanentFailureCode) => {
      const delivery: Delivery = transitioned(started().recordPermanentFailure(TOKEN_A(), code));

      expect(delivery.snapshot().state).toEqual({ status: 'FAILED', reason: code });
    },
  );

  it('요청을 시작하지 않은 Delivery에는 발송 결과를 기록할 수 없다', () => {
    expect(claimed().recordAccepted(TOKEN_A(), messageId(), at(SETTLED_ISO))).toEqual({
      kind: 'rejected',
      reason: 'REQUEST_NOT_STARTED',
    });
  });

  it('DLV-15 leaseToken이 바뀐 Delivery (다른 워커가 이어받음) / 이전 워커가 결과를 저장한다 → 저장이 거부된다', () => {
    const delivery: Delivery = started();

    expect(delivery.recordAccepted(TOKEN_B(), messageId(), at(SETTLED_ISO))).toEqual({
      kind: 'rejected',
      reason: 'LEASE_MISMATCH',
    });
    expect(delivery.startRequest(TOKEN_B(), at(SETTLED_ISO), MAX_REQUEST_MS)).toEqual({
      kind: 'rejected',
      reason: 'LEASE_MISMATCH',
    });
    expect(delivery.snapshot().state.status).toBe('IN_FLIGHT');
  });

  it('DLV-02 이미 요청을 시작한 Delivery는 같은 lease로 다시 요청을 시작할 수 없다', () => {
    const delivery: Delivery = started();

    expect(delivery.startRequest(TOKEN_A(), at(SETTLED_ISO), MAX_REQUEST_MS)).toEqual({
      kind: 'rejected',
      reason: 'REQUEST_ALREADY_STARTED',
    });
    expect(delivery.snapshot().attempts).toBe(1);
  });

  it('DLV-16 이미 요청을 시작한 Delivery는 lease가 부족해도 반납되지 않는다 (나간 요청 기록을 잃지 않는다)', () => {
    const almostExpired: Date = new Date(at(CLAIMED_ISO).getTime() + LEASE_MS - MAX_REQUEST_MS + 1);

    expect(started().startRequest(TOKEN_A(), almostExpired, MAX_REQUEST_MS)).toEqual({
      kind: 'rejected',
      reason: 'REQUEST_ALREADY_STARTED',
    });
  });

  it.each<InvalidDurationCase>([
    ['0', 0],
    ['음수', -1],
    ['NaN', Number.NaN],
    ['무한대', Number.POSITIVE_INFINITY],
    ['소수', 1.5],
  ])(
    'lease 길이와 요청 최대 시간은 %s(%s)을 유효한 시간으로 인정하지 않는다',
    (_label: string, value: number) => {
      expect(DurationPredicates.isDurationMs(value)).toBe(false);
    },
  );

  it('검증하지 않은 number는 lease 길이나 요청 최대 시간으로 넘길 수 없다', () => {
    expectTypeOf<number>().not.toExtend<DurationMs>();
    expectTypeOf<Parameters<Delivery['claim']>[2]>().toEqualTypeOf<DurationMs>();
    expectTypeOf<Parameters<Delivery['startRequest']>[2]>().toEqualTypeOf<DurationMs>();
  });

  it('DLV-16 남은 lease 시간이 HTTP 최대 실행 시간보다 짧은 IN_FLIGHT Delivery / 요청을 시작하려 한다 → 요청을 시작하지 않고 lease를 반납한다', () => {
    const almostExpired: Date = new Date(at(CLAIMED_ISO).getTime() + LEASE_MS - MAX_REQUEST_MS + 1);

    const delivery: Delivery = released(
      claimed().startRequest(TOKEN_A(), almostExpired, MAX_REQUEST_MS),
    );

    expect(delivery.snapshot()).toMatchObject({ attempts: 0, state: { status: 'PENDING' } });
  });

  it.each<StatusBuildCase>([
    ['SENT', (): Delivery => sent()],
    ['FAILED', (): Delivery => failed()],
  ])(
    'DLV-20 %s Delivery / 어떤 결과든 다시 기록하려 한다 → 종결 상태는 바뀌지 않는다',
    (_status: string, build: () => Delivery) => {
      const delivery: Delivery = build();
      const before: DeliverySnapshot = delivery.snapshot();

      expect(delivery.recordAccepted(TOKEN_A(), messageId(), at(SETTLED_ISO))).toEqual({
        kind: 'rejected',
        reason: 'ALREADY_SETTLED',
      });
      expect(delivery.recordPermanentFailure(TOKEN_A(), 'INVALID_REQUEST')).toEqual({
        kind: 'rejected',
        reason: 'ALREADY_SETTLED',
      });
      expect(delivery.claim(TOKEN_B(), at(SETTLED_ISO), LEASE_MS)).toEqual({
        kind: 'rejected',
        reason: 'NOT_CLAIMABLE',
      });
      expect(delivery.snapshot()).toEqual(before);
    },
  );

  it('snapshot으로 받은 Date를 바꿔도 Delivery 내부 상태는 바뀌지 않는다', () => {
    const delivery: Delivery = started();
    const { state, createdAt }: DeliverySnapshot = delivery.snapshot();

    createdAt.setUTCFullYear(1990);
    if (state.status === 'IN_FLIGHT' && state.request.kind === 'STARTED') {
      state.lease.expiresAt.setUTCFullYear(1990);
      state.request.at.setUTCFullYear(1990);
    }

    expect(delivery.snapshot()).toMatchObject({
      createdAt: at(T0_ISO),
      state: { request: { kind: 'STARTED', at: at(STARTED_ISO) } },
    });
  });

  it('DLV-05 IN_FLIGHT Delivery / 500/503을 받는다 → RETRY_WAIT가 되고 지수 백오프(+jitter)로 다음 시도 시각이 정해진다', () => {
    const delivery: Delivery = transitioned(
      started().recordTransientFailure(TOKEN_A(), at(SETTLED_ISO), retryPolicy(5), jitter(0)),
    );

    expect(delivery.snapshot()).toMatchObject({
      attempts: 1,
      state: {
        status: 'RETRY_WAIT',
        cause: 'TRANSIENT_FAILURE',
        retryAt: new Date(at(SETTLED_ISO).getTime() + 500),
      },
    });
  });

  it('DLV-06 최대 시도 횟수에 도달한 Delivery / 500/503을 받는다 → FAILED(RETRY_EXHAUSTED)가 된다', () => {
    const delivery: Delivery = transitioned(
      started().recordTransientFailure(TOKEN_A(), at(SETTLED_ISO), retryPolicy(1), jitter(0)),
    );

    expect(delivery.snapshot().state).toEqual({ status: 'FAILED', reason: 'RETRY_EXHAUSTED' });
  });

  it('DLV-07 IN_FLIGHT Delivery / 429와 Retry-After: n을 받는다 → RETRY_WAIT가 되고 n초 뒤로 미뤄지며 시도 횟수는 되돌린다', () => {
    const delivery: Delivery = transitioned(
      started().recordRateLimited(TOKEN_A(), at(SETTLED_ISO), durationMs(3_000)),
    );

    expect(delivery.snapshot()).toMatchObject({
      attempts: 0,
      state: {
        status: 'RETRY_WAIT',
        cause: 'RATE_LIMITED',
        retryAt: new Date(at(SETTLED_ISO).getTime() + 3_000),
      },
    });
  });

  it('DLV-06 실패와 재시도를 반복하면 429는 횟수에 넣지 않고, 최대 시도 횟수에서 정확히 FAILED가 된다', () => {
    const policy: RetryPolicy = retryPolicy(3);
    const steps: ReadonlyArray<RetryStep> = ['TRANSIENT', 'RATE_LIMITED', 'TRANSIENT', 'TRANSIENT'];
    const history: string[] = [];
    let current: Delivery = pending();

    steps.forEach((step: RetryStep, index: number): void => {
      const now: Date = new Date(at(CLAIMED_ISO).getTime() + (index + 1) * 60_000);
      const token: LeaseToken = leaseToken(String(index).padStart(2, '0'));
      const inFlight: Delivery = transitioned(
        transitioned(current.claim(token, now, LEASE_MS)).startRequest(token, now, MAX_REQUEST_MS),
      );
      current = transitioned(
        step === 'TRANSIENT'
          ? inFlight.recordTransientFailure(token, now, policy, jitter(0))
          : inFlight.recordRateLimited(token, now, durationMs(1_000)),
      );
      const { attempts, state }: DeliverySnapshot = current.snapshot();
      history.push(`${attempts}:${state.status}`);
    });

    expect(history).toEqual(['1:RETRY_WAIT', '1:RETRY_WAIT', '2:RETRY_WAIT', '3:FAILED']);
  });

  it('재시도 시각 전의 RETRY_WAIT Delivery는 claim할 수 없고, 시각이 지나면 claim할 수 있다', () => {
    const waiting: Delivery = transitioned(
      started().recordRateLimited(TOKEN_A(), at(SETTLED_ISO), durationMs(3_000)),
    );
    const due: Date = new Date(at(SETTLED_ISO).getTime() + 3_000);

    expect(waiting.claim(TOKEN_B(), new Date(due.getTime() - 1), LEASE_MS)).toEqual({
      kind: 'rejected',
      reason: 'NOT_CLAIMABLE',
    });
    expect(transitioned(waiting.claim(TOKEN_B(), due, LEASE_MS)).snapshot().state).toMatchObject({
      status: 'IN_FLIGHT',
      lease: { token: TOKEN_B() },
    });
  });

  it('요청을 시작하지 않았거나 lease가 다르면 재시도 결과도 기록할 수 없다', () => {
    expect(
      claimed().recordTransientFailure(TOKEN_A(), at(SETTLED_ISO), retryPolicy(5), jitter(0)),
    ).toEqual({ kind: 'rejected', reason: 'REQUEST_NOT_STARTED' });
    expect(started().recordRateLimited(TOKEN_B(), at(SETTLED_ISO), durationMs(3_000))).toEqual({
      kind: 'rejected',
      reason: 'LEASE_MISMATCH',
    });
  });

  it('DLV-08 IN_FLIGHT Delivery / 응답 타임아웃·연결 오류가 난다 → 재전송하지 않고 UNKNOWN이 되며 reconcile 가능 시각(요청 시작 + RECONCILE_DELAY_MS)이 기록된다', () => {
    const delivery: Delivery = unknownAfterTimeout();

    expect(delivery.snapshot()).toMatchObject({
      attempts: 1,
      state: {
        status: 'UNKNOWN',
        unknownSince: at(SETTLED_ISO),
        reconcileAt: new Date(at(STARTED_ISO).getTime() + RECONCILE_DELAY_MS),
        lookupFailures: 0,
      },
    });
  });

  it('DLV-08 요청을 시작하지 않았거나 lease가 다르면 UNKNOWN으로 기록할 수 없다', () => {
    expect(claimed().recordUnknown(TOKEN_A(), at(SETTLED_ISO), RECONCILE_DELAY_MS)).toEqual({
      kind: 'rejected',
      reason: 'REQUEST_NOT_STARTED',
    });
    expect(started().recordUnknown(TOKEN_B(), at(SETTLED_ISO), RECONCILE_DELAY_MS)).toEqual({
      kind: 'rejected',
      reason: 'LEASE_MISMATCH',
    });
  });

  it('DLV-11 reconcile 가능 시각 전의 UNKNOWN Delivery / reconcile 대상을 고른다 → 대상에서 빠진다 (이전 요청이 아직 진행 중일 수 있음)', () => {
    const delivery: Delivery = unknownAfterTimeout();
    const reconcileAt: number = at(STARTED_ISO).getTime() + RECONCILE_DELAY_MS;

    expect(delivery.isReconcilableAt(new Date(reconcileAt - 1))).toBe(false);
    expect(delivery.isReconcilableAt(new Date(reconcileAt))).toBe(true);
  });

  it('DLV-11 UNKNOWN이 아닌 Delivery는 reconcile 대상이 아니다', () => {
    const farFuture: Date = new Date('2030-01-01T00:00:00.000Z');

    expect(
      [pending(), started(), sent()].map((delivery: Delivery): boolean =>
        delivery.isReconcilableAt(farFuture),
      ),
    ).toEqual([false, false, false]);
  });

  it.each<StatusBuildCase>([
    ['요청 시작 전', (): Delivery => claimed()],
    ['요청 시작 후', (): Delivery => started()],
  ])(
    'DLV-14 lease가 만료된 IN_FLIGHT Delivery (워커 종료, %s) / 복구를 실행한다 → 재전송하지 않고 UNKNOWN으로 넘기며 reconcile 가능 시각(lease 만료 + RECONCILE_DELAY_MS)을 기록한다',
    (_label: string, build: () => Delivery) => {
      const delivery: Delivery = transitioned(
        build().recoverExpiredLease(at(LEASE_EXPIRED_ISO), RECONCILE_DELAY_MS),
      );

      expect(delivery.snapshot().state).toEqual({
        status: 'UNKNOWN',
        unknownSince: at(LEASE_EXPIRED_ISO),
        reconcileAt: new Date(at(LEASE_EXPIRED_ISO).getTime() + RECONCILE_DELAY_MS),
        lookupFailures: 0,
      });
    },
  );

  it('DLV-14 lease가 아직 유효하면 복구하지 않는다', () => {
    const beforeExpiry: Date = new Date(at(LEASE_EXPIRED_ISO).getTime() - 1);

    expect(started().recoverExpiredLease(beforeExpiry, RECONCILE_DELAY_MS)).toEqual({
      kind: 'rejected',
      reason: 'LEASE_NOT_EXPIRED',
    });
  });

  it('UNKNOWN Delivery의 snapshot 시각을 바꿔도 내부 상태는 바뀌지 않는다', () => {
    const delivery: Delivery = unknownAfterTimeout();
    const { state }: DeliverySnapshot = delivery.snapshot();

    if (state.status === 'UNKNOWN') {
      state.unknownSince.setUTCFullYear(1990);
      state.reconcileAt.setUTCFullYear(1990);
    }

    expect(delivery.snapshot().state).toMatchObject({
      unknownSince: at(SETTLED_ISO),
      reconcileAt: new Date(at(STARTED_ISO).getTime() + RECONCILE_DELAY_MS),
    });
  });

  it.todo(
    'DLV-09 UNKNOWN Delivery / reconcile에서 같은 clientRef의 발송 내역 1건을 찾는다 → SENT가 되고 messageId가 기록된다',
  );
  it.todo(
    'DLV-10 reconcile 가능 시각이 지난 UNKNOWN Delivery / reconcile에서 발송 내역이 없다 → 최대 시도 횟수 안이면 RETRY_WAIT, 소진했으면 FAILED(RETRY_EXHAUSTED)가 된다',
  );
  it.todo(
    'DLV-12 UNKNOWN Delivery / 발송 내역 조회 자체가 실패한다 → 빈 내역으로 보지 않고 UNKNOWN을 유지하며 백오프 후 다음 조회를 예약한다',
  );
  it.todo(
    'DLV-13 UNKNOWN Delivery / 같은 clientRef의 발송 내역이 2건 이상 나온다 → SENT가 되고 중복 발송 건수가 기록된다',
  );
  it.todo('DLV-17 PENDING·RETRY_WAIT Delivery / 알림이 취소된다 → CANCELLED가 된다');
  it.todo(
    'DLV-18 알림이 취소된 뒤의 IN_FLIGHT Delivery / 늦게 202를 받는다 → 이미 나간 사실대로 SENT가 된다',
  );
  it.todo(
    'DLV-19 UNKNOWN Delivery이고 알림이 취소됐다 / reconcile에서 발송 내역이 없다 → 재시도 대신 CANCELLED가 된다',
  );
  it.todo(
    'DLV-21 확인 기간(UNCONFIRMED_AFTER_MS)이 지난 UNKNOWN Delivery / reconcile 대상을 고른다 → 재전송하지 않고 UNCONFIRMED로 종결된다',
  );
});
