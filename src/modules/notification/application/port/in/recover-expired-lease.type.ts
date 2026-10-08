export interface NothingToRecover {
  readonly kind: 'idle';
}

export interface LeaseRecovered {
  readonly kind: 'recovered';
  readonly deliveryId: string;
}

export interface RecoveryLeaseLost {
  readonly kind: 'lease-lost';
  readonly deliveryId: string;
}

export type RecoveryAttempt = NothingToRecover | LeaseRecovered | RecoveryLeaseLost;
