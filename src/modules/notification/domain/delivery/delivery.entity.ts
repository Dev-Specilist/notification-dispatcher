import { RetryPolicy } from '@/modules/notification/domain/delivery/retry-policy';
import {
  DeliveryRejected,
  DeliveryRejectionReason,
  DeliverySnapshot,
  DeliveryState,
  DeliveryTransition,
  FoundMessages,
  InFlightState,
  JitterRatio,
  LeaseToken,
  MessageId,
  NewDelivery,
  PermanentFailureCode,
  RecordedMessage,
  RequestRecord,
  UnknownState,
} from '@/modules/notification/domain/delivery/delivery.type';
import { DurationMs } from '@/shared/domain/duration.type';

interface LeaseHeld {
  readonly kind: 'held';
  readonly state: InFlightState;
}

type LeaseCheck = LeaseHeld | DeliveryRejected;

interface RequestInProgress {
  readonly kind: 'started';
  readonly startedAt: Date;
}

type StartedCheck = RequestInProgress | DeliveryRejected;

interface UnknownHeld {
  readonly kind: 'held';
  readonly state: UnknownState;
}

type UnknownCheck = UnknownHeld | DeliveryRejected;

export class Delivery {
  private constructor(private readonly props: DeliverySnapshot) {}

  static create(delivery: Readonly<NewDelivery>, now: Readonly<Date>): Delivery {
    const { id, alarmId, recipientId, priority }: Readonly<NewDelivery> = delivery;
    return new Delivery({
      id,
      alarmId,
      recipientId,
      priority,
      attempts: 0,
      state: { status: 'PENDING' },
      createdAt: Delivery.copyDate(now),
    });
  }

  claim(token: LeaseToken, now: Readonly<Date>, leaseMs: DurationMs): DeliveryTransition {
    if (!this.isClaimableAt(now)) {
      return Delivery.reject('NOT_CLAIMABLE');
    }
    return this.transitionTo(this.props.attempts, {
      status: 'IN_FLIGHT',
      lease: { token, expiresAt: new Date(now.getTime() + leaseMs) },
      request: { kind: 'NOT_STARTED' },
    });
  }

  startRequest(
    token: LeaseToken,
    now: Readonly<Date>,
    maxRequestMs: DurationMs,
  ): DeliveryTransition {
    const check: LeaseCheck = this.checkLease(token);
    if (check.kind === 'rejected') {
      return check;
    }
    const { state }: LeaseHeld = check;
    if (state.request.kind === 'STARTED') {
      return Delivery.reject('REQUEST_ALREADY_STARTED');
    }
    const remainingMs: number = state.lease.expiresAt.getTime() - now.getTime();
    if (remainingMs < maxRequestMs) {
      return {
        kind: 'released',
        delivery: new Delivery({ ...this.snapshot(), state: { status: 'PENDING' } }),
      };
    }
    return this.transitionTo(this.props.attempts + 1, {
      ...state,
      request: { kind: 'STARTED', at: Delivery.copyDate(now) },
    });
  }

  recordAccepted(token: LeaseToken, messageId: MessageId, now: Readonly<Date>): DeliveryTransition {
    const check: StartedCheck = this.checkStartedRequest(token);
    if (check.kind === 'rejected') {
      return check;
    }
    return this.transitionTo(this.props.attempts, {
      status: 'SENT',
      messageId,
      sentAt: Delivery.copyDate(now),
      duplicateCount: 0,
    });
  }

  recordPermanentFailure(token: LeaseToken, reason: PermanentFailureCode): DeliveryTransition {
    const check: StartedCheck = this.checkStartedRequest(token);
    if (check.kind === 'rejected') {
      return check;
    }
    return this.transitionTo(this.props.attempts, { status: 'FAILED', reason });
  }

  recordTransientFailure(
    token: LeaseToken,
    now: Readonly<Date>,
    policy: RetryPolicy,
    jitter: JitterRatio,
  ): DeliveryTransition {
    const check: StartedCheck = this.checkStartedRequest(token);
    if (check.kind === 'rejected') {
      return check;
    }
    const { attempts }: DeliverySnapshot = this.props;
    if (policy.isExhausted(attempts)) {
      return this.transitionTo(attempts, { status: 'FAILED', reason: 'RETRY_EXHAUSTED' });
    }
    return this.transitionTo(attempts, {
      status: 'RETRY_WAIT',
      retryAt: new Date(now.getTime() + policy.delayFor(attempts, jitter)),
      cause: 'TRANSIENT_FAILURE',
    });
  }

  recordRateLimited(
    token: LeaseToken,
    now: Readonly<Date>,
    retryAfterMs: DurationMs,
  ): DeliveryTransition {
    const check: StartedCheck = this.checkStartedRequest(token);
    if (check.kind === 'rejected') {
      return check;
    }
    return this.transitionTo(Math.max(0, this.props.attempts - 1), {
      status: 'RETRY_WAIT',
      retryAt: new Date(now.getTime() + retryAfterMs),
      cause: 'RATE_LIMITED',
    });
  }

  recordUnknown(
    token: LeaseToken,
    now: Readonly<Date>,
    reconcileDelayMs: DurationMs,
  ): DeliveryTransition {
    const check: StartedCheck = this.checkStartedRequest(token);
    if (check.kind === 'rejected') {
      return check;
    }
    return this.transitionTo(this.props.attempts, {
      status: 'UNKNOWN',
      unknownSince: Delivery.copyDate(now),
      reconcileAt: new Date(check.startedAt.getTime() + reconcileDelayMs),
      lookupFailures: 0,
    });
  }

  recoverExpiredLease(now: Readonly<Date>, reconcileDelayMs: DurationMs): DeliveryTransition {
    const { state }: DeliverySnapshot = this.props;
    if (state.status !== 'IN_FLIGHT') {
      return Delivery.reject('NOT_IN_FLIGHT');
    }
    const { expiresAt }: InFlightState['lease'] = state.lease;
    if (expiresAt.getTime() > now.getTime()) {
      return Delivery.reject('LEASE_NOT_EXPIRED');
    }
    return this.transitionTo(this.props.attempts, {
      status: 'UNKNOWN',
      unknownSince: Delivery.copyDate(now),
      reconcileAt: new Date(expiresAt.getTime() + reconcileDelayMs),
      lookupFailures: 0,
    });
  }

  reconcileFound(found: FoundMessages): DeliveryTransition {
    const check: UnknownCheck = this.checkUnknown();
    if (check.kind === 'rejected') {
      return check;
    }
    const [first, ...rest]: FoundMessages = found;
    const earliest: RecordedMessage = rest.reduce(
      (current: RecordedMessage, next: RecordedMessage): RecordedMessage =>
        next.sentAt.getTime() < current.sentAt.getTime() ? next : current,
      first,
    );
    return this.transitionTo(this.props.attempts, {
      status: 'SENT',
      messageId: earliest.messageId,
      sentAt: Delivery.copyDate(earliest.sentAt),
      duplicateCount: rest.length,
    });
  }

  reconcileNotFound(
    now: Readonly<Date>,
    policy: RetryPolicy,
    jitter: JitterRatio,
  ): DeliveryTransition {
    const check: UnknownCheck = this.checkUnknown();
    if (check.kind === 'rejected') {
      return check;
    }
    if (!this.isReconcilableAt(now)) {
      return Delivery.reject('NOT_RECONCILABLE');
    }
    const { attempts }: DeliverySnapshot = this.props;
    if (policy.isExhausted(attempts)) {
      return this.transitionTo(attempts, { status: 'FAILED', reason: 'RETRY_EXHAUSTED' });
    }
    return this.transitionTo(attempts, {
      status: 'RETRY_WAIT',
      retryAt: new Date(now.getTime() + policy.delayFor(attempts, jitter)),
      cause: 'NOT_DELIVERED',
    });
  }

  recordLookupFailure(
    now: Readonly<Date>,
    policy: RetryPolicy,
    jitter: JitterRatio,
  ): DeliveryTransition {
    const check: UnknownCheck = this.checkUnknown();
    if (check.kind === 'rejected') {
      return check;
    }
    const lookupFailures: number = check.state.lookupFailures + 1;
    return this.transitionTo(this.props.attempts, {
      ...check.state,
      reconcileAt: new Date(now.getTime() + policy.delayFor(lookupFailures, jitter)),
      lookupFailures,
    });
  }

  expireUnconfirmed(now: Readonly<Date>, unconfirmedAfterMs: DurationMs): DeliveryTransition {
    const check: UnknownCheck = this.checkUnknown();
    if (check.kind === 'rejected') {
      return check;
    }
    const { unknownSince }: UnknownState = check.state;
    if (now.getTime() - unknownSince.getTime() < unconfirmedAfterMs) {
      return Delivery.reject('CONFIRM_WINDOW_OPEN');
    }
    return this.transitionTo(this.props.attempts, {
      status: 'UNCONFIRMED',
      unknownSince: Delivery.copyDate(unknownSince),
      unconfirmedAt: Delivery.copyDate(now),
    });
  }

  isReconcilableAt(now: Readonly<Date>): boolean {
    const { state }: DeliverySnapshot = this.props;
    return state.status === 'UNKNOWN' && state.reconcileAt.getTime() <= now.getTime();
  }

  snapshot(): DeliverySnapshot {
    return {
      ...this.props,
      state: Delivery.copyState(this.props.state),
      createdAt: Delivery.copyDate(this.props.createdAt),
    };
  }

  private isClaimableAt(now: Readonly<Date>): boolean {
    const { state }: DeliverySnapshot = this.props;
    if (state.status === 'PENDING') {
      return true;
    }
    return state.status === 'RETRY_WAIT' && state.retryAt.getTime() <= now.getTime();
  }

  private checkStartedRequest(token: LeaseToken): StartedCheck {
    const check: LeaseCheck = this.checkLease(token);
    if (check.kind === 'rejected') {
      return check;
    }
    const { request }: InFlightState = check.state;
    if (request.kind === 'NOT_STARTED') {
      return Delivery.reject('REQUEST_NOT_STARTED');
    }
    return { kind: 'started', startedAt: request.at };
  }

  private checkUnknown(): UnknownCheck {
    const { state }: DeliverySnapshot = this.props;
    if (Delivery.isSettled(state)) {
      return Delivery.reject('ALREADY_SETTLED');
    }
    if (state.status !== 'UNKNOWN') {
      return Delivery.reject('NOT_UNKNOWN');
    }
    return { kind: 'held', state };
  }

  private checkLease(token: LeaseToken): LeaseCheck {
    const { state }: DeliverySnapshot = this.props;
    if (Delivery.isSettled(state)) {
      return Delivery.reject('ALREADY_SETTLED');
    }
    if (state.status !== 'IN_FLIGHT') {
      return Delivery.reject('NOT_IN_FLIGHT');
    }
    if (state.lease.token !== token) {
      return Delivery.reject('LEASE_MISMATCH');
    }
    return { kind: 'held', state };
  }

  private transitionTo(attempts: number, state: DeliveryState): DeliveryTransition {
    return {
      kind: 'transitioned',
      delivery: new Delivery({ ...this.snapshot(), attempts, state }),
    };
  }

  private static isSettled(state: DeliveryState): boolean {
    return state.status === 'SENT' || state.status === 'FAILED' || state.status === 'UNCONFIRMED';
  }

  private static copyState(state: DeliveryState): DeliveryState {
    switch (state.status) {
      case 'PENDING':
        return { status: 'PENDING' };
      case 'IN_FLIGHT':
        return {
          status: 'IN_FLIGHT',
          lease: { token: state.lease.token, expiresAt: Delivery.copyDate(state.lease.expiresAt) },
          request: Delivery.copyRequest(state.request),
        };
      case 'RETRY_WAIT':
        return { ...state, retryAt: Delivery.copyDate(state.retryAt) };
      case 'UNKNOWN':
        return {
          ...state,
          unknownSince: Delivery.copyDate(state.unknownSince),
          reconcileAt: Delivery.copyDate(state.reconcileAt),
        };
      case 'SENT':
        return { ...state, sentAt: Delivery.copyDate(state.sentAt) };
      case 'UNCONFIRMED':
        return {
          status: 'UNCONFIRMED',
          unknownSince: Delivery.copyDate(state.unknownSince),
          unconfirmedAt: Delivery.copyDate(state.unconfirmedAt),
        };
      case 'FAILED':
        break;
    }
    return { status: 'FAILED', reason: state.reason };
  }

  private static copyRequest(request: RequestRecord): RequestRecord {
    return request.kind === 'NOT_STARTED'
      ? { kind: 'NOT_STARTED' }
      : { kind: 'STARTED', at: Delivery.copyDate(request.at) };
  }

  private static copyDate(date: Readonly<Date>): Date {
    return new Date(date.getTime());
  }

  private static reject(reason: DeliveryRejectionReason): DeliveryRejected {
    return { kind: 'rejected', reason };
  }
}
