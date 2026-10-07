import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';

export interface AlarmFound {
  readonly kind: 'found';
  readonly alarm: Alarm;
}

export interface AlarmMissing {
  readonly kind: 'missing';
}

export type AlarmLookup = AlarmFound | AlarmMissing;
