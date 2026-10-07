import type { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { Brand } from '@/shared/domain/brand.type';

export type AlarmId = string & Brand<'AlarmId'>;

export type RecipientId = string & Brand<'RecipientId'>;

export type DeliveryCount = number & Brand<'DeliveryCount'>;

export type AlarmKind = 'BULK' | 'URGENT';

export interface AllUsersTarget {
  readonly kind: 'ALL_USERS';
}

export interface ExplicitTarget {
  readonly kind: 'EXPLICIT';
  readonly recipientIds: ReadonlyArray<RecipientId>;
}

export interface DraftState {
  readonly status: 'DRAFT';
}

export interface DispatchingState {
  readonly status: 'DISPATCHING';
  readonly dispatchedAt: Date;
}

export interface CompletedState {
  readonly status: 'COMPLETED';
  readonly dispatchedAt: Date;
  readonly completedAt: Date;
}

export interface NeverDispatched {
  readonly kind: 'NEVER';
}

export interface DispatchStarted {
  readonly kind: 'STARTED';
  readonly at: Date;
}

export type DispatchRecord = NeverDispatched | DispatchStarted;

export interface CancelledState {
  readonly status: 'CANCELLED';
  readonly cancelledAt: Date;
  readonly dispatch: DispatchRecord;
}

export type AlarmState = DraftState | DispatchingState | CompletedState | CancelledState;

export type AlarmStatus = AlarmState['status'];

export type CancellableState = DraftState | DispatchingState;

export interface AlarmDraft {
  readonly title: string;
  readonly body: string;
  readonly kind: AlarmKind;
  readonly recipientIds: ReadonlyArray<string>;
}

export interface AlarmSnapshotBase {
  readonly id: AlarmId;
  readonly title: string;
  readonly body: string;
  readonly state: AlarmState;
  readonly createdAt: Date;
}

export interface BulkAlarmSnapshot extends AlarmSnapshotBase {
  readonly kind: 'BULK';
  readonly target: AllUsersTarget;
}

export interface UrgentAlarmSnapshot extends AlarmSnapshotBase {
  readonly kind: 'URGENT';
  readonly target: ExplicitTarget;
}

export type AlarmSnapshot = BulkAlarmSnapshot | UrgentAlarmSnapshot;

export type AlarmAudience =
  Pick<BulkAlarmSnapshot, 'kind' | 'target'> | Pick<UrgentAlarmSnapshot, 'kind' | 'target'>;

export interface CountRange {
  readonly min: number;
  readonly max: number;
}

export interface EmptyTitle {
  readonly code: 'EMPTY_TITLE';
}

export interface EmptyBody {
  readonly code: 'EMPTY_BODY';
}

export interface BulkRecipientsNotAllowed {
  readonly code: 'BULK_RECIPIENTS_NOT_ALLOWED';
}

export interface UrgentRecipientsOutOfRange extends CountRange {
  readonly code: 'URGENT_RECIPIENTS_OUT_OF_RANGE';
  readonly count: number;
}

export interface InvalidRecipientId {
  readonly code: 'INVALID_RECIPIENT_ID';
  readonly value: string;
}

export type AlarmValidationError =
  | EmptyTitle
  | EmptyBody
  | BulkRecipientsNotAllowed
  | UrgentRecipientsOutOfRange
  | InvalidRecipientId;

export interface AlarmCreated {
  readonly kind: 'created';
  readonly alarm: Alarm;
}

export interface AlarmRejected {
  readonly kind: 'rejected';
  readonly error: AlarmValidationError;
}

export type AlarmCreation = AlarmCreated | AlarmRejected;

export type AlarmAction = 'dispatch' | 'cancel' | 'complete';

export interface AlarmStateConflict {
  readonly code: 'ALARM_STATE_CONFLICT';
  readonly status: AlarmStatus;
  readonly action: AlarmAction;
}

export interface AlarmTransitioned {
  readonly kind: 'transitioned';
  readonly alarm: Alarm;
}

export interface AlarmConflicted {
  readonly kind: 'conflict';
  readonly error: AlarmStateConflict;
}

export interface AlarmUnchanged {
  readonly kind: 'unchanged';
  readonly alarm: Alarm;
}

export type AlarmTransition = AlarmTransitioned | AlarmConflicted;

export type AlarmCompletion = AlarmTransitioned | AlarmUnchanged | AlarmConflicted;

export interface CompletionEvidence {
  readonly expansionCompleted: boolean;
  readonly unsettledDeliveries: DeliveryCount;
}
