import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';

export interface ClaimableFound {
  readonly kind: 'found';
  readonly delivery: Delivery;
}

export interface NothingClaimable {
  readonly kind: 'none';
}

export type ClaimableLookup = ClaimableFound | NothingClaimable;

export interface LeasedSaved {
  readonly kind: 'saved';
}

export interface LeaseLost {
  readonly kind: 'lease-lost';
}

export type LeasedSave = LeasedSaved | LeaseLost;
