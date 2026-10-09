import { DeliveryStatus } from '@/modules/notification/domain/delivery/delivery.type';

export class DeliveryStatusPredicates {
  static readonly SETTLED: ReadonlyArray<DeliveryStatus> = Object.freeze<
    ReadonlyArray<DeliveryStatus>
  >(['SENT', 'FAILED', 'UNCONFIRMED', 'CANCELLED']);

  static readonly WAITING: ReadonlyArray<DeliveryStatus> = Object.freeze<
    ReadonlyArray<DeliveryStatus>
  >(['PENDING', 'RETRY_WAIT']);

  static readonly OUTCOME_PENDING: ReadonlyArray<DeliveryStatus> = Object.freeze<
    ReadonlyArray<DeliveryStatus>
  >(['IN_FLIGHT', 'UNKNOWN']);

  static isSettled(status: DeliveryStatus): boolean {
    return DeliveryStatusPredicates.SETTLED.includes(status);
  }

  static isWaiting(status: DeliveryStatus): boolean {
    return DeliveryStatusPredicates.WAITING.includes(status);
  }
}
