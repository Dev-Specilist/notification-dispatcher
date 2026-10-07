import {
  AttemptLimit,
  DeliveryId,
  JitterRatio,
  LeaseToken,
  MessageId,
  RetryAfterMs,
} from '@/modules/notification/domain/delivery/delivery.type';

export class DeliveryPredicates {
  static readonly MAX_RETRY_AFTER_MS: number = 3_600_000;

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

  static isRetryAfterMs(value: number): value is RetryAfterMs {
    return (
      Number.isSafeInteger(value) && value >= 0 && value <= DeliveryPredicates.MAX_RETRY_AFTER_MS
    );
  }

  static isAttemptLimit(value: number): value is AttemptLimit {
    return Number.isSafeInteger(value) && value >= 1;
  }

  static isJitterRatio(value: number): value is JitterRatio {
    return Number.isFinite(value) && value >= 0 && value < 1;
  }
}
