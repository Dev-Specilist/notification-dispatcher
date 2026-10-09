import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';

export interface CandidateFound {
  readonly kind: 'found';
  readonly delivery: Delivery;
}

export interface NoCandidate {
  readonly kind: 'none';
}

export type DeliveryCandidate = CandidateFound | NoCandidate;

export interface LeasedSaved {
  readonly kind: 'saved';
}

export interface LeaseLost {
  readonly kind: 'lease-lost';
}

export type LeasedSave = LeasedSaved | LeaseLost;

export interface ReconciledSaved {
  readonly kind: 'saved';
}

export interface ReconcileSuperseded {
  readonly kind: 'superseded';
}

export type ReconciledSave = ReconciledSaved | ReconcileSuperseded;
