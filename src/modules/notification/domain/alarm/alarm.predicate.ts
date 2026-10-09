import {
  AlarmId,
  DeliveryCount,
  RecipientId,
} from '@/modules/notification/domain/alarm/alarm.type';
import { UuidPredicates } from '@/shared/domain/uuid.predicate';

export class AlarmPredicates {
  private static readonly RECIPIENT_ID: RegExp = /^\S+$/;

  static isAlarmId(value: string): value is AlarmId {
    return UuidPredicates.isUuid(value);
  }

  static isRecipientId(value: string): value is RecipientId {
    return AlarmPredicates.RECIPIENT_ID.test(value);
  }

  static isDeliveryCount(value: number): value is DeliveryCount {
    return Number.isSafeInteger(value) && value >= 0;
  }
}
