import { ListPosition } from '@/modules/notification/application/port/driving/for-managing-alarms/list-alarms.type';

export interface CursorDecoded {
  readonly kind: 'decoded';
  readonly position: ListPosition;
}

export interface CursorInvalid {
  readonly kind: 'invalid';
}

export type CursorDecoding = CursorDecoded | CursorInvalid;
