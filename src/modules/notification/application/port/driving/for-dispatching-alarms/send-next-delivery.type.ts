import { SendOutcomeKind } from '@/modules/notification/application/port/driven/for-sending-messages/message-sender.type';

export interface NoPermit {
  readonly kind: 'no-permit';
}

export interface NothingToSend {
  readonly kind: 'idle';
}

export interface DeliverySkipped {
  readonly kind: 'skipped';
  readonly deliveryId: string;
}

export interface LeaseReleased {
  readonly kind: 'released';
  readonly deliveryId: string;
}

export interface OutcomeRecorded {
  readonly kind: 'recorded';
  readonly deliveryId: string;
  readonly outcome: SendOutcomeKind;
}

export interface ResultDiscarded {
  readonly kind: 'lease-lost';
  readonly deliveryId: string;
}

export interface LeaseTooShortToSend {
  readonly kind: 'lease-too-short';
  readonly deliveryId: string;
}

export type SendAttempt =
  | NoPermit
  | NothingToSend
  | DeliverySkipped
  | LeaseReleased
  | LeaseTooShortToSend
  | OutcomeRecorded
  | ResultDiscarded;
