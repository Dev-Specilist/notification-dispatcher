import { AlarmKindName } from '@/modules/notification/application/port/in/alarm-view.type';
import { DeliveryStatusName } from '@/modules/notification/application/port/in/delivery-progress-view.type';

export interface AlarmResponseBase {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly kind: AlarmKindName;
  readonly recipientIds: ReadonlyArray<string>;
  readonly createdAt: string;
}

export interface DraftAlarmResponse extends AlarmResponseBase {
  readonly status: 'DRAFT';
}

export interface DispatchingAlarmResponse extends AlarmResponseBase {
  readonly status: 'DISPATCHING';
  readonly dispatchedAt: string;
}

export interface CompletedAlarmResponse extends AlarmResponseBase {
  readonly status: 'COMPLETED';
  readonly dispatchedAt: string;
  readonly completedAt: string;
}

export interface CancelledBeforeDispatchResponse extends AlarmResponseBase {
  readonly status: 'CANCELLED';
  readonly cancelledAt: string;
}

export interface CancelledAfterDispatchResponse extends CancelledBeforeDispatchResponse {
  readonly dispatchedAt: string;
}

export type AlarmResponse =
  | DraftAlarmResponse
  | DispatchingAlarmResponse
  | CompletedAlarmResponse
  | CancelledBeforeDispatchResponse
  | CancelledAfterDispatchResponse;

export interface DeliveryProgressResponse {
  readonly total: number;
  readonly byStatus: Readonly<Record<DeliveryStatusName, number>>;
}

export interface DeliveriesSection {
  readonly deliveries: DeliveryProgressResponse;
}

export type AlarmDetailResponse = AlarmResponse & DeliveriesSection;
