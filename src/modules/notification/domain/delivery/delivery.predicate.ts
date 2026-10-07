import {
  DeliveryId,
  LeaseToken,
  MessageId,
} from '@/modules/notification/domain/delivery/delivery.type';

export class DeliveryPredicates {
  private static readonly UUID: RegExp =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  private static readonly NON_BLANK: RegExp = /^\S+$/;

  static isDeliveryId(value: string): value is DeliveryId {
    return DeliveryPredicates.UUID.test(value);
  }

  static isLeaseToken(value: string): value is LeaseToken {
    return DeliveryPredicates.UUID.test(value);
  }

  static isMessageId(value: string): value is MessageId {
    return DeliveryPredicates.NON_BLANK.test(value);
  }
}
