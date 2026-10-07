import { AlarmId, RecipientId } from '@/modules/notification/domain/alarm/alarm.type';
import {
  DeliveryId,
  MessageId,
  PermanentFailureCode,
  RetryAfterMs,
} from '@/modules/notification/domain/delivery/delivery.type';

export interface OutgoingMessage {
  readonly alarmId: AlarmId;
  readonly recipientId: RecipientId;
  readonly body: string;
  readonly clientRef: DeliveryId;
}

export interface SendAccepted {
  readonly kind: 'accepted';
  readonly messageId: MessageId;
}

export interface SendPermanentlyFailed {
  readonly kind: 'permanent-failure';
  readonly code: PermanentFailureCode;
}

export interface SendTransientlyFailed {
  readonly kind: 'transient-failure';
}

export interface SendRateLimited {
  readonly kind: 'rate-limited';
  readonly retryAfterMs: RetryAfterMs;
}

export interface SendOutcomeIndeterminate {
  readonly kind: 'indeterminate';
}

export type SendOutcome =
  | SendAccepted
  | SendPermanentlyFailed
  | SendTransientlyFailed
  | SendRateLimited
  | SendOutcomeIndeterminate;

export type SendOutcomeKind = SendOutcome['kind'];
