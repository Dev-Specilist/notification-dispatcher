import {
  AlarmKindName,
  AlarmStatusName,
  AlarmView,
} from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-view.type';

export interface AnyValueFilter {
  readonly kind: 'any';
}

export interface ExactValueFilter<TValue> {
  readonly kind: 'exactly';
  readonly value: TValue;
}

export type ListFilter<TValue> = AnyValueFilter | ExactValueFilter<TValue>;

export interface ListPosition {
  readonly createdAt: Date;
  readonly alarmId: string;
}

export interface StartFromNewest {
  readonly kind: 'newest';
}

export interface StartAfterPosition {
  readonly kind: 'after';
  readonly position: ListPosition;
}

export type ListStart = StartFromNewest | StartAfterPosition;

export interface ListAlarmsQuery {
  readonly status: ListFilter<AlarmStatusName>;
  readonly alarmKind: ListFilter<AlarmKindName>;
  readonly start: ListStart;
  readonly limit: number;
}

export interface LastListPage {
  readonly kind: 'last';
}

export interface MoreListPages {
  readonly kind: 'more';
  readonly after: ListPosition;
}

export type ListNext = LastListPage | MoreListPages;

export interface AlarmListPage {
  readonly kind: 'page';
  readonly items: ReadonlyArray<AlarmView>;
  readonly next: ListNext;
}

export interface InvalidCursorError {
  readonly code: 'INVALID_CURSOR';
}

export interface InvalidLimitError {
  readonly code: 'INVALID_LIMIT';
  readonly limit: number;
}

export type ListAlarmsError = InvalidCursorError | InvalidLimitError;

export interface ListAlarmsRejected {
  readonly kind: 'rejected';
  readonly error: ListAlarmsError;
}

export type ListAlarmsResult = AlarmListPage | ListAlarmsRejected;
