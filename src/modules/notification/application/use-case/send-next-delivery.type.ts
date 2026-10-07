import { DeliveryId } from '@/modules/notification/domain/delivery/delivery.type';

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

export interface DeliverySent {
  readonly kind: 'sent';
  readonly deliveryId: DeliveryId;
}

export interface ResultDiscarded {
  readonly kind: 'lease-lost';
  readonly deliveryId: DeliveryId;
}

export type SendAttempt =
  NoPermit | NothingToSend | DeliverySkipped | LeaseReleased | DeliverySent | ResultDiscarded;
