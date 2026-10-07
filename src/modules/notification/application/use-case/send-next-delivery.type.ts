import { DeliveryId } from '@/modules/notification/domain/delivery/delivery.type';
import { SendOutcomeKind } from '@/modules/notification/application/port/message-sender.type';

export interface NoPermit {
  readonly kind: 'no-permit';
}

export interface NothingToSend {
  readonly kind: 'idle';
}

export interface DeliverySkipped {
  readonly kind: 'skipped';
  readonly deliveryId: DeliveryId;
}

export interface LeaseReleased {
  readonly kind: 'released';
  readonly deliveryId: DeliveryId;
}

export interface OutcomeRecorded {
  readonly kind: 'recorded';
  readonly deliveryId: DeliveryId;
  readonly outcome: SendOutcomeKind;
}

export interface ResultDiscarded {
  readonly kind: 'lease-lost';
  readonly deliveryId: DeliveryId;
}

export type SendAttempt =
  NoPermit | NothingToSend | DeliverySkipped | LeaseReleased | OutcomeRecorded | ResultDiscarded;
