export type DeliveryStatusName =
  | 'PENDING'
  | 'IN_FLIGHT'
  | 'RETRY_WAIT'
  | 'UNKNOWN'
  | 'SENT'
  | 'FAILED'
  | 'UNCONFIRMED'
  | 'CANCELLED';

export interface DeliveryProgressView {
  readonly total: number;
  readonly byStatus: Readonly<Record<DeliveryStatusName, number>>;
}
