export type AlarmKindName = 'BULK' | 'URGENT';

export interface DraftAlarmState {
  readonly status: 'DRAFT';
}

export interface DispatchingAlarmState {
  readonly status: 'DISPATCHING';
  readonly dispatchedAt: Date;
}

export interface CompletedAlarmState {
  readonly status: 'COMPLETED';
  readonly dispatchedAt: Date;
  readonly completedAt: Date;
}

export interface CancelledBeforeDispatchState {
  readonly status: 'CANCELLED';
  readonly cancelledAt: Date;
}

export interface CancelledAfterDispatchState extends CancelledBeforeDispatchState {
  readonly dispatchedAt: Date;
}

export type AlarmViewState =
  | DraftAlarmState
  | DispatchingAlarmState
  | CompletedAlarmState
  | CancelledBeforeDispatchState
  | CancelledAfterDispatchState;

export interface AlarmView {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly kind: AlarmKindName;
  readonly recipientIds: ReadonlyArray<string>;
  readonly state: AlarmViewState;
  readonly createdAt: Date;
}

export type AlarmStatusName = AlarmViewState['status'];
