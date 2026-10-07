import {
  DeliveryRejected,
  DeliveryRejectionReason,
  DeliverySnapshot,
  DeliveryState,
  DeliveryTransition,
  InFlightState,
  LeaseToken,
  MessageId,
  NewDelivery,
  PermanentFailureCode,
  RequestRecord,
} from '@/modules/notification/domain/delivery/delivery.type';
import { DurationMs } from '@/shared/domain/duration.type';

interface LeaseHeld {
  readonly kind: 'held';
  readonly state: InFlightState;
}

type LeaseCheck = LeaseHeld | DeliveryRejected;

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
    if (this.props.state.status !== 'PENDING') {
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
    const check: LeaseCheck = this.checkStartedRequest(token);
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
    const check: LeaseCheck = this.checkStartedRequest(token);
    if (check.kind === 'rejected') {
      return check;
    }
    return this.transitionTo(this.props.attempts, { status: 'FAILED', reason });
  }

  snapshot(): DeliverySnapshot {
    return {
      ...this.props,
      state: Delivery.copyState(this.props.state),
      createdAt: Delivery.copyDate(this.props.createdAt),
    };
  }

  private checkStartedRequest(token: LeaseToken): LeaseCheck {
    const check: LeaseCheck = this.checkLease(token);
    if (check.kind === 'held' && check.state.request.kind === 'NOT_STARTED') {
      return Delivery.reject('REQUEST_NOT_STARTED');
    }
    return check;
  }

  private checkLease(token: LeaseToken): LeaseCheck {
    const { state }: DeliverySnapshot = this.props;
    if (state.status === 'SENT' || state.status === 'FAILED') {
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
      case 'SENT':
        return { ...state, sentAt: Delivery.copyDate(state.sentAt) };
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
