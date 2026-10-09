import { DeliveryStatusName } from '@/modules/notification/application/port/driving/for-managing-alarms/delivery-progress-view.type';

export interface NothingToReconcile {
  readonly kind: 'idle';
}

export interface DeliveryReconciled {
  readonly kind: 'reconciled';
  readonly deliveryId: string;
  readonly status: DeliveryStatusName;
}

export interface ReconcileSuperseded {
  readonly kind: 'superseded';
  readonly deliveryId: string;
}

export type ReconcileAttempt = NothingToReconcile | DeliveryReconciled | ReconcileSuperseded;
