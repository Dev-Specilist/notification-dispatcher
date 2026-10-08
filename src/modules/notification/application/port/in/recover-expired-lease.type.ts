import { DeliveryId } from '@/modules/notification/domain/delivery/delivery.type';

export interface NothingToRecover {
  readonly kind: 'idle';
}

export interface LeaseRecovered {
  readonly kind: 'recovered';
  readonly deliveryId: DeliveryId;
}

export interface RecoveryLeaseLost {
  readonly kind: 'lease-lost';
  readonly deliveryId: DeliveryId;
}

export type RecoveryAttempt = NothingToRecover | LeaseRecovered | RecoveryLeaseLost;
