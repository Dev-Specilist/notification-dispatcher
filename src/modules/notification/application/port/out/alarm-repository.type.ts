import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmId, AlarmKind, AlarmStatus } from '@/modules/notification/domain/alarm/alarm.type';
import { Brand } from '@/shared/domain/brand.type';

export interface AlarmFound {
  readonly kind: 'found';
  readonly alarm: Alarm;
}

export interface AlarmMissing {
  readonly kind: 'missing';
}

export type AlarmLookup = AlarmFound | AlarmMissing;

export type PageSize = number & Brand<'PageSize'>;

export interface AlarmPosition {
  readonly createdAt: Date;
  readonly id: AlarmId;
}

export interface FromNewest {
  readonly kind: 'newest';
}

export interface AfterPosition {
  readonly kind: 'after';
  readonly position: AlarmPosition;
}

export type AlarmPageStart = FromNewest | AfterPosition;

export interface MatchAny {
  readonly kind: 'any';
}

export interface MatchExactly<TValue> {
  readonly kind: 'exactly';
  readonly value: TValue;
}

export type ValueFilter<TValue> = MatchAny | MatchExactly<TValue>;

export interface AlarmPageQuery {
  readonly status: ValueFilter<AlarmStatus>;
  readonly alarmKind: ValueFilter<AlarmKind>;
  readonly start: AlarmPageStart;
  readonly size: PageSize;
}

export interface LastAlarmPage {
  readonly kind: 'last';
}

export interface MoreAlarmPages {
  readonly kind: 'more';
  readonly after: AlarmPosition;
}

export type AlarmPageNext = LastAlarmPage | MoreAlarmPages;

export interface AlarmPage {
  readonly alarms: ReadonlyArray<Alarm>;
  readonly next: AlarmPageNext;
}
