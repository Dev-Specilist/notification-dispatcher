import { AlarmId, RecipientId } from '@/modules/notification/domain/alarm/alarm.type';

export class AlarmPredicates {
  private static readonly UUID: RegExp =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  private static readonly RECIPIENT_ID: RegExp = /^\S+$/;

  static isAlarmId(value: string): value is AlarmId {
    return AlarmPredicates.UUID.test(value);
  }

  static isRecipientId(value: string): value is RecipientId {
    return AlarmPredicates.RECIPIENT_ID.test(value);
  }
}
