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
  FoundMessages,
  JitterRatio,
  LeaseToken,
  MessageId,
  PermanentFailureCode,
  RetryAfterMs,
} from '@/modules/notification/domain/delivery/delivery.type';
import { KindAssertion, KindMember } from '@/shared/testing/kind.assertion';

type StatusBuildCase = Readonly<[string, () => Delivery]>;

type InvalidDurationCase = Readonly<[string, number]>;

type RetryAfterCase = Readonly<[string, number]>;

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

const retryAfterMs = (value: number): RetryAfterMs => {
  if (!DeliveryPredicates.isRetryAfterMs(value)) {
    throw new Error(`test fixture ${value} is not a valid RetryAfterMs`);
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
const RECONCILABLE_ISO: string = '2026-10-07T09:00:37.000Z';
const UNCONFIRMED_AFTER_MS: DurationMs = durationMs(600_000);
const UNCONFIRMED_ISO: string = '2026-10-07T09:10:03.000Z';
const CANCELLED_ISO: string = '2026-10-07T09:00:05.000Z';

const retryPolicy = (maxAttempts: number): RetryPolicy => {
  const creation: RetryPolicyCreation = RetryPolicy.create({
    maxAttempts: attemptLimit(maxAttempts),
    baseDelayMs: durationMs(1_000),
    maxDelayMs: durationMs(8_000),
  });
  KindAssertion.assertKind(creation, 'created');
  const { policy }: KindMember<RetryPolicyCreation, 'created'> = creation;
  return policy;
};

const at = (iso: string): Date => new Date(iso);

const deliveryId = (): DeliveryId => {
  const rawDeliveryId: string = '5f1d2a8c-3b4e-4c6d-9e7f-8a9b0c1d2e3f';
  if (!DeliveryPredicates.isDeliveryId(rawDeliveryId)) {
    throw new Error('test fixture is not a valid DeliveryId');
  }
  return rawDeliveryId;
};

const alarmId = (): AlarmId => {
  const rawAlarmId: string = '0b6c1b4e-9a37-4c2a-8d6a-2f6b2d7f1a10';
  if (!AlarmPredicates.isAlarmId(rawAlarmId)) {
    throw new Error('test fixture is not a valid AlarmId');
  }
  return rawAlarmId;
};

const recipientId = (): RecipientId => {
  const rawRecipientId: string = 'u_000001';
  if (!AlarmPredicates.isRecipientId(rawRecipientId)) {
    throw new Error('test fixture is not a valid RecipientId');
  }
  return rawRecipientId;
};

const leaseToken = (suffix: string): LeaseToken => {
  const rawLeaseToken: string = `9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c${suffix}`;
  if (!DeliveryPredicates.isLeaseToken(rawLeaseToken)) {
    throw new Error('test fixture is not a valid LeaseToken');
  }
  return rawLeaseToken;
};

const messageId = (): MessageId => {
  const rawMessageId: string = 'm_1';
  if (!DeliveryPredicates.isMessageId(rawMessageId)) {
    throw new Error('test fixture is not a valid MessageId');
  }
  return rawMessageId;
};

const messageIdOf = (value: string): MessageId => {
  if (!DeliveryPredicates.isMessageId(value)) {
    throw new Error(`test fixture ${value} is not a valid MessageId`);
  }
  return value;
};

const TOKEN_A: () => LeaseToken = (): LeaseToken => leaseToken('aa');
const TOKEN_B: () => LeaseToken = (): LeaseToken => leaseToken('bb');

const released = (result: DeliveryTransition): Delivery => {
  KindAssertion.assertKind(result, 'released');
  const { delivery }: KindMember<DeliveryTransition, 'released'> = result;
  return delivery;
};

const transitioned = (result: DeliveryTransition): Delivery => {
  KindAssertion.assertKind(result, 'transitioned');
  const { delivery }: KindMember<DeliveryTransition, 'transitioned'> = result;
  return delivery;
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

const unconfirmed = (): Delivery =>
  transitioned(unknownAfterTimeout().expireUnconfirmed(at(UNCONFIRMED_ISO), UNCONFIRMED_AFTER_MS));

const retryWaiting = (): Delivery =>
  transitioned(
    started().recordTransientFailure(TOKEN_A(), at(SETTLED_ISO), retryPolicy(3), jitter(0)),
  );

const cancelled = (): Delivery => transitioned(pending().cancel(at(CANCELLED_ISO)));

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

  it('DLV-16 요청 시작을 기록한 뒤 실제로 보내기 직전에도 남은 lease가 HTTP 최대 실행 시간 이상인지 판정한다', (): void => {
    const lastSendableAt: Date = new Date(at(CLAIMED_ISO).getTime() + LEASE_MS - MAX_REQUEST_MS);
    const tooLateAt: Date = new Date(lastSendableAt.getTime() + 1);

    expect(started().hasLeaseTimeFor(lastSendableAt, MAX_REQUEST_MS)).toBe(true);
    expect(started().hasLeaseTimeFor(tooLateAt, MAX_REQUEST_MS)).toBe(false);
    expect(pending().hasLeaseTimeFor(at(CLAIMED_ISO), MAX_REQUEST_MS)).toBe(false);
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

  it('DLV-24 요청 시작을 기록했지만 실제로 보내지 않은 IN_FLIGHT Delivery / 보내지 않은 요청을 거둬들인다 → 시도 횟수를 요청 시작 전으로 되돌리고 lease를 반납해 PENDING으로 돌아간다', (): void => {
    const delivery: Delivery = released(started().abandonUnsentRequest(TOKEN_A()));

    expect(delivery.snapshot()).toMatchObject({ attempts: 0, state: { status: 'PENDING' } });
    expect(delivery.isClaimableAt(at(SETTLED_ISO))).toBe(true);
  });

  it('DLV-24 재시도 중이던 Delivery도 보내지 않은 요청을 거두면 그 전까지의 시도 횟수를 유지한다', (): void => {
    const retryClaimedAt: Date = at(LEASE_EXPIRED_ISO);
    const retryClaimed: Delivery = transitioned(
      retryWaiting().claim(TOKEN_B(), retryClaimedAt, LEASE_MS),
    );
    const retryStarted: Delivery = transitioned(
      retryClaimed.startRequest(TOKEN_B(), retryClaimedAt, MAX_REQUEST_MS),
    );

    const delivery: Delivery = released(retryStarted.abandonUnsentRequest(TOKEN_B()));

    expect(retryStarted.snapshot().attempts).toBe(2);
    expect(delivery.snapshot()).toMatchObject({ attempts: 1, state: { status: 'PENDING' } });
  });

  it('DLV-24 다른 leaseToken이거나 요청을 시작하지 않았거나 IN_FLIGHT가 아니면 요청을 거둘 수 없다', (): void => {
    expect(started().abandonUnsentRequest(TOKEN_B())).toEqual({
      kind: 'rejected',
      reason: 'LEASE_MISMATCH',
    });
    expect(claimed().abandonUnsentRequest(TOKEN_A())).toEqual({
      kind: 'rejected',
      reason: 'REQUEST_NOT_STARTED',
    });
    expect(pending().abandonUnsentRequest(TOKEN_A())).toEqual({
      kind: 'rejected',
      reason: 'NOT_IN_FLIGHT',
    });
    expect(unknownAfterTimeout().abandonUnsentRequest(TOKEN_A())).toEqual({
      kind: 'rejected',
      reason: 'NOT_IN_FLIGHT',
    });
  });

  it.each<StatusBuildCase>([
    ['SENT', (): Delivery => sent()],
    ['FAILED', (): Delivery => failed()],
    ['UNCONFIRMED', (): Delivery => unconfirmed()],
    ['CANCELLED', (): Delivery => cancelled()],
  ])(
    'DLV-24 종결된 %s Delivery는 요청을 거둘 수 없고 상태가 바뀌지 않는다',
    (_status: string, build: () => Delivery): void => {
      const delivery: Delivery = build();
      const before: DeliverySnapshot = delivery.snapshot();

      expect(delivery.abandonUnsentRequest(TOKEN_A())).toEqual({
        kind: 'rejected',
        reason: 'ALREADY_SETTLED',
      });
      expect(delivery.snapshot()).toEqual(before);
    },
  );

  it.each<StatusBuildCase>([
    ['SENT', (): Delivery => sent()],
    ['FAILED', (): Delivery => failed()],
    ['UNCONFIRMED', (): Delivery => unconfirmed()],
    ['CANCELLED', (): Delivery => cancelled()],
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
      started().recordRateLimited(TOKEN_A(), at(SETTLED_ISO), retryAfterMs(3_000)),
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

  it.each<RetryAfterCase>([
    ['0', 0],
    ['1초', 1_000],
    ['상한 1시간', 3_600_000],
  ])(
    'DLV-07 Retry-After 대기 시간은 %s(%s ms)를 허용한다',
    (_label: string, value: number): void => {
      expect(DeliveryPredicates.isRetryAfterMs(value)).toBe(true);
    },
  );

  it.each<RetryAfterCase>([
    ['음수', -1],
    ['소수', 1.5],
    ['1시간 초과', 3_600_001],
    ['NaN', Number.NaN],
  ])(
    'DLV-07 Retry-After 대기 시간은 %s(%s)을 허용하지 않는다 (0 이상 1시간 이하 정수)',
    (_label: string, value: number): void => {
      expect(DeliveryPredicates.isRetryAfterMs(value)).toBe(false);
    },
  );

  it('DLV-22 IN_FLIGHT Delivery / 발송 API에 연결 자체를 하지 못한다 → RETRY_WAIT(UNREACHABLE)가 되고 대기 시간 뒤로 미뤄지며 시도 횟수는 되돌린다', (): void => {
    const delivery: Delivery = transitioned(
      started().recordUnreachable(TOKEN_A(), at(SETTLED_ISO), retryAfterMs(5_000)),
    );

    expect(delivery.snapshot()).toMatchObject({
      attempts: 0,
      state: {
        status: 'RETRY_WAIT',
        cause: 'UNREACHABLE',
        retryAt: new Date(at(SETTLED_ISO).getTime() + 5_000),
      },
    });
  });

  it('DLV-22 다른 leaseToken으로 연결 실패를 기록하면 거부된다', (): void => {
    const transition: DeliveryTransition = started().recordUnreachable(
      TOKEN_B(),
      at(SETTLED_ISO),
      retryAfterMs(5_000),
    );

    expect(transition.kind).toBe('rejected');
  });

  it('DLV-07 Retry-After: 0이면 재시도 시각을 지금으로 기록하고 시도 횟수는 되돌린다', (): void => {
    const delivery: Delivery = transitioned(
      started().recordRateLimited(TOKEN_A(), at(SETTLED_ISO), retryAfterMs(0)),
    );

    expect(delivery.snapshot()).toMatchObject({
      attempts: 0,
      state: { status: 'RETRY_WAIT', cause: 'RATE_LIMITED', retryAt: at(SETTLED_ISO) },
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
          : inFlight.recordRateLimited(token, now, retryAfterMs(1_000)),
      );
      const { attempts, state }: DeliverySnapshot = current.snapshot();
      history.push(`${attempts}:${state.status}`);
    });

    expect(history).toEqual(['1:RETRY_WAIT', '1:RETRY_WAIT', '2:RETRY_WAIT', '3:FAILED']);
  });

  it('재시도 시각 전의 RETRY_WAIT Delivery는 claim할 수 없고, 시각이 지나면 claim할 수 있다', () => {
    const waiting: Delivery = transitioned(
      started().recordRateLimited(TOKEN_A(), at(SETTLED_ISO), retryAfterMs(3_000)),
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
    expect(started().recordRateLimited(TOKEN_B(), at(SETTLED_ISO), retryAfterMs(3_000))).toEqual({
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

  it('DLV-09 UNKNOWN Delivery / reconcile에서 같은 clientRef의 발송 내역 1건을 찾는다 → SENT가 되고 messageId가 기록된다', () => {
    const found: FoundMessages = [{ messageId: messageIdOf('m_9'), sentAt: at(SETTLED_ISO) }];

    const delivery: Delivery = transitioned(unknownAfterTimeout().reconcileFound(found));

    expect(delivery.snapshot()).toMatchObject({
      attempts: 1,
      state: { status: 'SENT', messageId: 'm_9', sentAt: at(SETTLED_ISO), duplicateCount: 0 },
    });
  });

  it.each<StatusBuildCase>([
    ['PENDING', pending],
    ['IN_FLIGHT', started],
  ])(
    'DLV-09 UNKNOWN이 아닌 %s Delivery에는 발송 내역을 반영할 수 없다',
    (_status: string, build: () => Delivery) => {
      const found: FoundMessages = [{ messageId: messageIdOf('m_9'), sentAt: at(SETTLED_ISO) }];

      expect(build().reconcileFound(found)).toEqual({ kind: 'rejected', reason: 'NOT_UNKNOWN' });
    },
  );

  it.each<StatusBuildCase>([
    ['SENT', sent],
    ['FAILED', failed],
    ['UNCONFIRMED', unconfirmed],
    ['CANCELLED', cancelled],
  ])(
    'DLV-20 종결된 %s Delivery에는 발송 내역을 반영해도 상태가 바뀌지 않는다',
    (_status: string, build: () => Delivery) => {
      const found: FoundMessages = [{ messageId: messageIdOf('m_9'), sentAt: at(SETTLED_ISO) }];

      expect(build().reconcileFound(found)).toEqual({
        kind: 'rejected',
        reason: 'ALREADY_SETTLED',
      });
    },
  );

  it('DLV-09 반영한 뒤 넘긴 발송 시각을 바꿔도 기록된 발송 시각은 바뀌지 않는다', () => {
    const sentAt: Date = at(SETTLED_ISO);
    const delivery: Delivery = transitioned(
      unknownAfterTimeout().reconcileFound([{ messageId: messageIdOf('m_9'), sentAt }]),
    );

    sentAt.setUTCFullYear(1990);

    expect(delivery.snapshot().state).toMatchObject({ sentAt: at(SETTLED_ISO) });
  });

  it('DLV-10 reconcile 가능 시각이 지난 UNKNOWN Delivery / reconcile에서 발송 내역이 없다 → 최대 시도 횟수 안이면 RETRY_WAIT가 된다', () => {
    const delivery: Delivery = transitioned(
      unknownAfterTimeout().reconcileNotFound(at(RECONCILABLE_ISO), retryPolicy(3), jitter(0)),
    );

    expect(delivery.snapshot()).toMatchObject({
      attempts: 1,
      state: {
        status: 'RETRY_WAIT',
        retryAt: new Date(at(RECONCILABLE_ISO).getTime() + 500),
        cause: 'NOT_DELIVERED',
      },
    });
  });

  it('DLV-10 reconcile 가능 시각이 지난 UNKNOWN Delivery / reconcile에서 발송 내역이 없다 → 시도 횟수를 소진했으면 FAILED(RETRY_EXHAUSTED)가 된다', () => {
    const delivery: Delivery = transitioned(
      unknownAfterTimeout().reconcileNotFound(at(RECONCILABLE_ISO), retryPolicy(1), jitter(0)),
    );

    expect(delivery.snapshot().state).toEqual({ status: 'FAILED', reason: 'RETRY_EXHAUSTED' });
  });

  it('DLV-10 발송 내역이 없어 RETRY_WAIT가 된 Delivery는 재시도 시각에 다시 claim할 수 있다', () => {
    const retryAt: Date = new Date(at(RECONCILABLE_ISO).getTime() + 500);
    const waiting: Delivery = transitioned(
      unknownAfterTimeout().reconcileNotFound(at(RECONCILABLE_ISO), retryPolicy(3), jitter(0)),
    );

    expect(waiting.claim(TOKEN_B(), retryAt, LEASE_MS).kind).toBe('transitioned');
  });

  it('DLV-11 reconcile 가능 시각 전의 UNKNOWN Delivery에는 내역 없음을 반영할 수 없다 (이전 요청이 아직 진행 중일 수 있음)', () => {
    const beforeReconcilable: Date = new Date(at(RECONCILABLE_ISO).getTime() - 1);

    expect(
      unknownAfterTimeout().reconcileNotFound(beforeReconcilable, retryPolicy(3), jitter(0)),
    ).toEqual({ kind: 'rejected', reason: 'NOT_RECONCILABLE' });
  });

  it.each<StatusBuildCase>([
    ['PENDING', pending],
    ['IN_FLIGHT', started],
  ])(
    'DLV-10 UNKNOWN이 아닌 %s Delivery에는 내역 없음을 반영할 수 없다',
    (_status: string, build: () => Delivery) => {
      expect(build().reconcileNotFound(at(RECONCILABLE_ISO), retryPolicy(3), jitter(0))).toEqual({
        kind: 'rejected',
        reason: 'NOT_UNKNOWN',
      });
    },
  );

  it.each<StatusBuildCase>([
    ['SENT', sent],
    ['FAILED', failed],
    ['UNCONFIRMED', unconfirmed],
    ['CANCELLED', cancelled],
  ])(
    'DLV-20 종결된 %s Delivery에는 내역 없음을 반영해도 상태가 바뀌지 않는다',
    (_status: string, build: () => Delivery) => {
      expect(build().reconcileNotFound(at(RECONCILABLE_ISO), retryPolicy(3), jitter(0))).toEqual({
        kind: 'rejected',
        reason: 'ALREADY_SETTLED',
      });
    },
  );
  it('DLV-12 UNKNOWN Delivery / 발송 내역 조회 자체가 실패한다 → 빈 내역으로 보지 않고 UNKNOWN을 유지하며 백오프 후 다음 조회를 예약한다', () => {
    const delivery: Delivery = transitioned(
      unknownAfterTimeout().recordLookupFailure(at(RECONCILABLE_ISO), retryPolicy(3), jitter(0)),
    );

    expect(delivery.snapshot()).toMatchObject({
      attempts: 1,
      state: {
        status: 'UNKNOWN',
        unknownSince: at(SETTLED_ISO),
        reconcileAt: new Date(at(RECONCILABLE_ISO).getTime() + 500),
        lookupFailures: 1,
      },
    });
  });

  it('DLV-12 조회 실패가 이어지면 실패 횟수가 쌓이고 다음 조회 간격이 늘어난다', () => {
    const firstFailedAt: Date = at(RECONCILABLE_ISO);
    const secondFailedAt: Date = new Date(firstFailedAt.getTime() + 500);
    const once: Delivery = transitioned(
      unknownAfterTimeout().recordLookupFailure(firstFailedAt, retryPolicy(3), jitter(0)),
    );

    const twice: Delivery = transitioned(
      once.recordLookupFailure(secondFailedAt, retryPolicy(3), jitter(0)),
    );

    expect(twice.snapshot().state).toMatchObject({
      reconcileAt: new Date(secondFailedAt.getTime() + 1_000),
      lookupFailures: 2,
    });
  });

  it('DLV-12 조회 실패가 최대 시도 횟수보다 많이 쌓여도 FAILED가 되지 않고 발송 시도 횟수도 그대로다', () => {
    const policy: RetryPolicy = retryPolicy(2);
    const failedAt: Date = at(RECONCILABLE_ISO);
    const failThrice: Delivery = [1, 2, 3].reduce(
      (delivery: Delivery): Delivery =>
        transitioned(delivery.recordLookupFailure(failedAt, policy, jitter(0))),
      unknownAfterTimeout(),
    );

    expect(failThrice.snapshot()).toMatchObject({
      attempts: 1,
      state: { status: 'UNKNOWN', lookupFailures: 3 },
    });
  });

  it('DLV-12 조회 실패 뒤에는 다시 예약한 시각부터 reconcile 대상이 된다', () => {
    const nextLookupAt: number = at(RECONCILABLE_ISO).getTime() + 500;
    const delivery: Delivery = transitioned(
      unknownAfterTimeout().recordLookupFailure(at(RECONCILABLE_ISO), retryPolicy(3), jitter(0)),
    );

    expect(delivery.isReconcilableAt(new Date(nextLookupAt - 1))).toBe(false);
    expect(delivery.isReconcilableAt(new Date(nextLookupAt))).toBe(true);
  });

  it('DLV-23 UNKNOWN Delivery / reconcile 대상으로 예약한다 → reconcile 가능 시각이 지금 + lease로 미뤄지고 결과 불명 시작 시각과 조회 실패 횟수는 유지된다', () => {
    const lookupFailed: Delivery = transitioned(
      unknownAfterTimeout().recordLookupFailure(at(RECONCILABLE_ISO), retryPolicy(3), jitter(0)),
    );
    const reservedAt: Date = new Date(at(RECONCILABLE_ISO).getTime() + 500);

    const reserved: Delivery = transitioned(lookupFailed.reserveReconcile(reservedAt, LEASE_MS));

    expect(reserved.snapshot()).toEqual({
      ...lookupFailed.snapshot(),
      state: {
        status: 'UNKNOWN',
        unknownSince: at(SETTLED_ISO),
        reconcileAt: new Date(reservedAt.getTime() + LEASE_MS),
        lookupFailures: 1,
      },
    });
  });

  it('DLV-23 예약한 UNKNOWN Delivery는 lease가 지나야 다시 reconcile 대상이 된다', () => {
    const reservedAt: Date = at(RECONCILABLE_ISO);
    const leaseEndsAt: number = reservedAt.getTime() + LEASE_MS;

    const reserved: Delivery = transitioned(
      unknownAfterTimeout().reserveReconcile(reservedAt, LEASE_MS),
    );

    expect(reserved.isReconcilableAt(new Date(leaseEndsAt - 1))).toBe(false);
    expect(reserved.isReconcilableAt(new Date(leaseEndsAt))).toBe(true);
  });

  it.each<StatusBuildCase>([
    ['PENDING', pending],
    ['IN_FLIGHT', started],
    ['RETRY_WAIT', retryWaiting],
  ])(
    'DLV-23 UNKNOWN이 아닌 %s Delivery는 reconcile 대상으로 예약할 수 없다',
    (_status: string, build: () => Delivery) => {
      expect(build().reserveReconcile(at(RECONCILABLE_ISO), LEASE_MS)).toEqual({
        kind: 'rejected',
        reason: 'NOT_UNKNOWN',
      });
    },
  );

  it.each<StatusBuildCase>([
    ['SENT', sent],
    ['FAILED', failed],
    ['UNCONFIRMED', unconfirmed],
    ['CANCELLED', cancelled],
  ])(
    'DLV-20 종결된 %s Delivery는 reconcile 대상으로 예약해도 상태가 바뀌지 않는다',
    (_status: string, build: () => Delivery) => {
      expect(build().reserveReconcile(at(RECONCILABLE_ISO), LEASE_MS)).toEqual({
        kind: 'rejected',
        reason: 'ALREADY_SETTLED',
      });
    },
  );

  it.each<StatusBuildCase>([
    ['PENDING', pending],
    ['IN_FLIGHT', started],
  ])(
    'DLV-12 UNKNOWN이 아닌 %s Delivery에는 조회 실패를 기록할 수 없다',
    (_status: string, build: () => Delivery) => {
      expect(build().recordLookupFailure(at(RECONCILABLE_ISO), retryPolicy(3), jitter(0))).toEqual({
        kind: 'rejected',
        reason: 'NOT_UNKNOWN',
      });
    },
  );

  it.each<StatusBuildCase>([
    ['SENT', sent],
    ['FAILED', failed],
    ['UNCONFIRMED', unconfirmed],
    ['CANCELLED', cancelled],
  ])(
    'DLV-20 종결된 %s Delivery에는 조회 실패를 기록해도 상태가 바뀌지 않는다',
    (_status: string, build: () => Delivery) => {
      expect(build().recordLookupFailure(at(RECONCILABLE_ISO), retryPolicy(3), jitter(0))).toEqual({
        kind: 'rejected',
        reason: 'ALREADY_SETTLED',
      });
    },
  );
  it('DLV-13 UNKNOWN Delivery / 같은 clientRef의 발송 내역이 2건 이상 나온다 → SENT가 되고 중복 발송 건수가 기록된다', () => {
    const found: FoundMessages = [
      { messageId: messageIdOf('m_late'), sentAt: at('2026-10-07T09:00:40.000Z') },
      { messageId: messageIdOf('m_first'), sentAt: at(STARTED_ISO) },
      { messageId: messageIdOf('m_mid'), sentAt: at(SETTLED_ISO) },
    ];

    const delivery: Delivery = transitioned(unknownAfterTimeout().reconcileFound(found));

    expect(delivery.snapshot().state).toEqual({
      status: 'SENT',
      messageId: 'm_first',
      sentAt: at(STARTED_ISO),
      duplicateCount: 2,
    });
  });

  it.each<StatusBuildCase>([
    ['PENDING', pending],
    ['RETRY_WAIT', retryWaiting],
  ])(
    'DLV-17 %s Delivery / 알림이 취소된다 → CANCELLED가 된다',
    (_status: string, build: () => Delivery) => {
      const delivery: Delivery = transitioned(build().cancel(at(CANCELLED_ISO)));

      expect(delivery.snapshot().state).toEqual({
        status: 'CANCELLED',
        cancelledAt: at(CANCELLED_ISO),
      });
    },
  );

  it('DLV-17 재시도 시각 전의 RETRY_WAIT Delivery도 바로 CANCELLED가 된다', () => {
    const beforeRetry: Date = at(SETTLED_ISO);

    expect(transitioned(retryWaiting().cancel(beforeRetry)).snapshot().state).toMatchObject({
      status: 'CANCELLED',
    });
  });

  it.each<StatusBuildCase>([
    ['IN_FLIGHT', started],
    ['UNKNOWN', unknownAfterTimeout],
  ])(
    'DLV-17 결과가 확정되지 않은 %s Delivery는 취소하지 않고 결과를 먼저 기다린다',
    (_status: string, build: () => Delivery) => {
      expect(build().cancel(at(CANCELLED_ISO))).toEqual({
        kind: 'rejected',
        reason: 'OUTCOME_PENDING',
      });
    },
  );

  it.each<StatusBuildCase>([
    ['SENT', sent],
    ['FAILED', failed],
    ['UNCONFIRMED', unconfirmed],
    ['CANCELLED', cancelled],
  ])(
    'DLV-20 종결된 %s Delivery는 취소해도 상태가 바뀌지 않는다',
    (_status: string, build: () => Delivery) => {
      expect(build().cancel(at(CANCELLED_ISO))).toEqual({
        kind: 'rejected',
        reason: 'ALREADY_SETTLED',
      });
    },
  );

  it.each<StatusBuildCase>([
    ['PENDING', pending],
    ['RETRY_WAIT', retryWaiting],
  ])(
    'DLV-17 대기 중인 %s Delivery는 대기 중일 때만 취소하면 CANCELLED가 된다',
    (_status: string, build: () => Delivery) => {
      expect(build().cancelIfWaiting(at(CANCELLED_ISO)).snapshot().state).toEqual({
        status: 'CANCELLED',
        cancelledAt: at(CANCELLED_ISO),
      });
    },
  );

  it.each<StatusBuildCase>([
    ['IN_FLIGHT', started],
    ['UNKNOWN', unknownAfterTimeout],
    ['SENT', sent],
    ['FAILED', failed],
    ['UNCONFIRMED', unconfirmed],
    ['CANCELLED', cancelled],
  ])(
    'DLV-17 대기 중이 아닌 %s Delivery는 대기 중일 때만 취소해도 그대로 남는다',
    (_status: string, build: () => Delivery) => {
      const delivery: Delivery = build();

      expect(delivery.cancelIfWaiting(at(UNCONFIRMED_ISO)).snapshot()).toEqual(delivery.snapshot());
    },
  );

  it('DLV-18 알림이 취소된 뒤의 IN_FLIGHT Delivery / 늦게 202를 받는다 → 이미 나간 사실대로 SENT가 된다', () => {
    const lateAcceptedAt: Date = at('2026-10-07T09:00:30.000Z');
    const inFlight: Delivery = started();

    expect(inFlight.cancel(at(CANCELLED_ISO))).toEqual({
      kind: 'rejected',
      reason: 'OUTCOME_PENDING',
    });

    const delivery: Delivery = transitioned(
      inFlight.recordAccepted(TOKEN_A(), messageId(), lateAcceptedAt),
    );

    expect(delivery.snapshot().state).toEqual({
      status: 'SENT',
      messageId: 'm_1',
      sentAt: lateAcceptedAt,
      duplicateCount: 0,
    });
  });

  it('DLV-17 CANCELLED snapshot으로 받은 Date를 바꿔도 Delivery 내부 상태는 바뀌지 않는다', () => {
    const delivery: Delivery = cancelled();
    const { state }: DeliverySnapshot = delivery.snapshot();

    if (state.status === 'CANCELLED') {
      state.cancelledAt.setUTCFullYear(1990);
    }

    expect(delivery.snapshot().state).toEqual({
      status: 'CANCELLED',
      cancelledAt: at(CANCELLED_ISO),
    });
  });

  it('DLV-19 UNKNOWN Delivery이고 알림이 취소됐다 / reconcile에서 발송 내역이 없다 → 재시도 대신 CANCELLED가 된다', () => {
    const delivery: Delivery = transitioned(
      unknownAfterTimeout().reconcileNotFoundAsCancelled(at(RECONCILABLE_ISO)),
    );

    expect(delivery.snapshot()).toMatchObject({
      attempts: 1,
      state: { status: 'CANCELLED', cancelledAt: at(RECONCILABLE_ISO) },
    });
  });

  it('DLV-19 reconcile 가능 시각 전에는 내역 없음을 취소로 반영할 수 없다 (이전 요청이 아직 진행 중일 수 있음)', () => {
    const beforeReconcilable: Date = new Date(at(RECONCILABLE_ISO).getTime() - 1);

    expect(unknownAfterTimeout().reconcileNotFoundAsCancelled(beforeReconcilable)).toEqual({
      kind: 'rejected',
      reason: 'NOT_RECONCILABLE',
    });
  });

  it.each<StatusBuildCase>([
    ['PENDING', pending],
    ['IN_FLIGHT', started],
  ])(
    'DLV-19 UNKNOWN이 아닌 %s Delivery에는 내역 없음을 취소로 반영할 수 없다',
    (_status: string, build: () => Delivery) => {
      expect(build().reconcileNotFoundAsCancelled(at(RECONCILABLE_ISO))).toEqual({
        kind: 'rejected',
        reason: 'NOT_UNKNOWN',
      });
    },
  );

  it.each<StatusBuildCase>([
    ['SENT', sent],
    ['FAILED', failed],
    ['UNCONFIRMED', unconfirmed],
    ['CANCELLED', cancelled],
  ])(
    'DLV-20 종결된 %s Delivery에는 내역 없음을 취소로 반영해도 상태가 바뀌지 않는다',
    (_status: string, build: () => Delivery) => {
      expect(build().reconcileNotFoundAsCancelled(at(RECONCILABLE_ISO))).toEqual({
        kind: 'rejected',
        reason: 'ALREADY_SETTLED',
      });
    },
  );
  it('DLV-21 확인 기간(UNCONFIRMED_AFTER_MS)이 지난 UNKNOWN Delivery / reconcile 대상을 고른다 → 재전송하지 않고 UNCONFIRMED로 종결된다', () => {
    expect(unconfirmed().snapshot()).toMatchObject({
      attempts: 1,
      state: {
        status: 'UNCONFIRMED',
        unknownSince: at(SETTLED_ISO),
        unconfirmedAt: at(UNCONFIRMED_ISO),
      },
    });
  });

  it('DLV-21 확인 기간이 남은 UNKNOWN Delivery는 UNCONFIRMED로 종결할 수 없다', () => {
    const beforeWindowEnds: Date = new Date(at(UNCONFIRMED_ISO).getTime() - 1);

    expect(unknownAfterTimeout().expireUnconfirmed(beforeWindowEnds, UNCONFIRMED_AFTER_MS)).toEqual(
      { kind: 'rejected', reason: 'CONFIRM_WINDOW_OPEN' },
    );
  });

  it('DLV-21 확인 기간은 조회 실패로 다음 조회가 미뤄져도 처음 UNKNOWN이 된 시각부터 잰다', () => {
    const lookupFailed: Delivery = transitioned(
      unknownAfterTimeout().recordLookupFailure(at(UNCONFIRMED_ISO), retryPolicy(3), jitter(0)),
    );

    expect(
      transitioned(
        lookupFailed.expireUnconfirmed(at(UNCONFIRMED_ISO), UNCONFIRMED_AFTER_MS),
      ).snapshot().state,
    ).toMatchObject({ status: 'UNCONFIRMED', unknownSince: at(SETTLED_ISO) });
  });

  it.each<StatusBuildCase>([
    ['PENDING', pending],
    ['IN_FLIGHT', started],
  ])(
    'DLV-21 UNKNOWN이 아닌 %s Delivery는 UNCONFIRMED로 종결할 수 없다',
    (_status: string, build: () => Delivery) => {
      expect(build().expireUnconfirmed(at(UNCONFIRMED_ISO), UNCONFIRMED_AFTER_MS)).toEqual({
        kind: 'rejected',
        reason: 'NOT_UNKNOWN',
      });
    },
  );

  it.each<StatusBuildCase>([
    ['SENT', sent],
    ['FAILED', failed],
    ['UNCONFIRMED', unconfirmed],
    ['CANCELLED', cancelled],
  ])(
    'DLV-20 종결된 %s Delivery는 다시 UNCONFIRMED로 종결해도 상태가 바뀌지 않는다',
    (_status: string, build: () => Delivery) => {
      expect(build().expireUnconfirmed(at(UNCONFIRMED_ISO), UNCONFIRMED_AFTER_MS)).toEqual({
        kind: 'rejected',
        reason: 'ALREADY_SETTLED',
      });
    },
  );

  it('DLV-21 UNCONFIRMED snapshot으로 받은 Date를 바꿔도 Delivery 내부 상태는 바뀌지 않는다', () => {
    const delivery: Delivery = unconfirmed();
    const { state }: DeliverySnapshot = delivery.snapshot();

    if (state.status === 'UNCONFIRMED') {
      state.unknownSince.setUTCFullYear(1990);
      state.unconfirmedAt.setUTCFullYear(1990);
    }

    expect(delivery.snapshot().state).toMatchObject({
      unknownSince: at(SETTLED_ISO),
      unconfirmedAt: at(UNCONFIRMED_ISO),
    });
  });

  it.each<StatusBuildCase>([
    ['PENDING', pending],
    ['IN_FLIGHT(요청 전)', claimed],
    ['IN_FLIGHT(요청 후)', started],
    ['RETRY_WAIT', retryWaiting],
    ['UNKNOWN', unknownAfterTimeout],
    ['SENT', sent],
    ['FAILED', failed],
    ['UNCONFIRMED', unconfirmed],
    ['CANCELLED', cancelled],
  ])(
    '저장된 %s Delivery의 snapshot으로 복원하면 같은 snapshot을 가진 Delivery가 된다',
    (_status: string, build: () => Delivery) => {
      const original: Delivery = build();

      expect(Delivery.reconstitute(original.snapshot()).snapshot()).toEqual(original.snapshot());
    },
  );

  it('복원에 넘긴 snapshot을 나중에 바꿔도 복원한 Delivery는 바뀌지 않는다', () => {
    const snapshot: DeliverySnapshot = started().snapshot();
    const delivery: Delivery = Delivery.reconstitute(snapshot);

    snapshot.createdAt.setUTCFullYear(1990);
    if (snapshot.state.status === 'IN_FLIGHT') {
      snapshot.state.lease.expiresAt.setUTCFullYear(1990);
    }

    expect(delivery.snapshot()).toEqual(started().snapshot());
  });

  it('복원한 Delivery도 lease fencing 규칙을 그대로 따른다', () => {
    const delivery: Delivery = Delivery.reconstitute(started().snapshot());

    expect(delivery.recordAccepted(TOKEN_B(), messageId(), at(SETTLED_ISO))).toEqual({
      kind: 'rejected',
      reason: 'LEASE_MISMATCH',
    });
  });
});
