import { DeliveryId, DeliveryStatus } from '@/modules/notification/domain/delivery/delivery.type';

export interface NothingToReconcile {
  readonly kind: 'idle';
}

export interface DeliveryReconciled {
  readonly kind: 'reconciled';
  readonly deliveryId: DeliveryId;
  readonly status: DeliveryStatus;
}

export interface ReconcileSuperseded {
  readonly kind: 'superseded';
  readonly deliveryId: DeliveryId;
}

export type ReconcileAttempt = NothingToReconcile | DeliveryReconciled | ReconcileSuperseded;
