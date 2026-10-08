import { ListPosition } from '@/modules/notification/application/port/in/list-alarms.type';

export interface CursorDecoded {
  readonly kind: 'decoded';
  readonly position: ListPosition;
}

export interface CursorInvalid {
  readonly kind: 'invalid';
}

export type CursorDecoding = CursorDecoded | CursorInvalid;
