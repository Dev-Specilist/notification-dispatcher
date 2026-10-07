import type { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import { AlarmId, RecipientId } from '@/modules/notification/domain/alarm/alarm.type';
import { Brand } from '@/shared/domain/brand.type';

export type DeliveryId = string & Brand<'DeliveryId'>;

export type LeaseToken = string & Brand<'LeaseToken'>;

export type MessageId = string & Brand<'MessageId'>;

export type AttemptLimit = number & Brand<'AttemptLimit'>;

export type JitterRatio = number & Brand<'JitterRatio'>;

export type DeliveryPriority = 'URGENT' | 'BULK';

export type PermanentFailureCode = 'RECIPIENT_BLOCKED' | 'UNKNOWN_RECIPIENT' | 'INVALID_REQUEST';

export type FailureReason = PermanentFailureCode | 'RETRY_EXHAUSTED';

export type RetryCause = 'TRANSIENT_FAILURE' | 'RATE_LIMITED' | 'NOT_DELIVERED';

export interface Lease {
  readonly token: LeaseToken;
  readonly expiresAt: Date;
}

export interface RequestNotStarted {
  readonly kind: 'NOT_STARTED';
}

export interface RequestStarted {
  readonly kind: 'STARTED';
  readonly at: Date;
}

export type RequestRecord = RequestNotStarted | RequestStarted;

export interface RecordedMessage {
  readonly messageId: MessageId;
  readonly sentAt: Date;
}

export type FoundMessages = Readonly<[RecordedMessage, ...ReadonlyArray<RecordedMessage>]>;

export interface PendingState {
  readonly status: 'PENDING';
}

export interface InFlightState {
  readonly status: 'IN_FLIGHT';
  readonly lease: Lease;
  readonly request: RequestRecord;
}

export interface RetryWaitState {
  readonly status: 'RETRY_WAIT';
  readonly retryAt: Date;
  readonly cause: RetryCause;
}

export interface UnknownState {
  readonly status: 'UNKNOWN';
  readonly unknownSince: Date;
  readonly reconcileAt: Date;
  readonly lookupFailures: number;
}

export interface SentState {
  readonly status: 'SENT';
  readonly messageId: MessageId;
  readonly sentAt: Date;
  readonly duplicateCount: number;
}

export interface FailedState {
  readonly status: 'FAILED';
  readonly reason: FailureReason;
}

export interface UnconfirmedState {
  readonly status: 'UNCONFIRMED';
  readonly unknownSince: Date;
  readonly unconfirmedAt: Date;
}

export type DeliveryState =
  | PendingState
  | InFlightState
  | RetryWaitState
  | UnknownState
  | SentState
  | FailedState
  | UnconfirmedState;

export type DeliveryStatus = DeliveryState['status'];

export interface NewDelivery {
  readonly id: DeliveryId;
  readonly alarmId: AlarmId;
  readonly recipientId: RecipientId;
  readonly priority: DeliveryPriority;
}

export interface DeliverySnapshot extends NewDelivery {
  readonly attempts: number;
  readonly state: DeliveryState;
  readonly createdAt: Date;
}

export type DeliveryRejectionReason =
  | 'NOT_CLAIMABLE'
  | 'NOT_IN_FLIGHT'
  | 'NOT_UNKNOWN'
  | 'NOT_RECONCILABLE'
  | 'CONFIRM_WINDOW_OPEN'
  | 'LEASE_MISMATCH'
  | 'REQUEST_NOT_STARTED'
  | 'REQUEST_ALREADY_STARTED'
  | 'ALREADY_SETTLED'
  | 'LEASE_NOT_EXPIRED';

export interface DeliveryTransitioned {
  readonly kind: 'transitioned';
  readonly delivery: Delivery;
}

export interface DeliveryReleased {
  readonly kind: 'released';
  readonly delivery: Delivery;
}

export interface DeliveryRejected {
  readonly kind: 'rejected';
  readonly reason: DeliveryRejectionReason;
}

export type DeliveryTransition = DeliveryTransitioned | DeliveryReleased | DeliveryRejected;
