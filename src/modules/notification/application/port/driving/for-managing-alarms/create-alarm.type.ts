import {
  AlarmKindName,
  AlarmView,
} from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-view.type';

export interface CreateAlarmCommand {
  readonly title: string;
  readonly body: string;
  readonly kind: AlarmKindName;
  readonly recipientIds: ReadonlyArray<string>;
}

export interface EmptyTitleError {
  readonly code: 'EMPTY_TITLE';
}

export interface EmptyBodyError {
  readonly code: 'EMPTY_BODY';
}

export interface BulkRecipientsNotAllowedError {
  readonly code: 'BULK_RECIPIENTS_NOT_ALLOWED';
}

export interface UrgentRecipientsOutOfRangeError {
  readonly code: 'URGENT_RECIPIENTS_OUT_OF_RANGE';
  readonly count: number;
  readonly min: number;
  readonly max: number;
}

export interface InvalidRecipientIdError {
  readonly code: 'INVALID_RECIPIENT_ID';
  readonly value: string;
}

export type AlarmCreationError =
  | EmptyTitleError
  | EmptyBodyError
  | BulkRecipientsNotAllowedError
  | UrgentRecipientsOutOfRangeError
  | InvalidRecipientIdError;

export interface AlarmCreatedResult {
  readonly kind: 'created';
  readonly alarm: AlarmView;
}

export interface AlarmCreationRejected {
  readonly kind: 'rejected';
  readonly error: AlarmCreationError;
}

export type CreateAlarmResult = AlarmCreatedResult | AlarmCreationRejected;
