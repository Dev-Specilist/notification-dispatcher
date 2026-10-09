import { AlarmReaderPort } from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-reader.port';
import { AlarmRepositoryPort } from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.port';
import { DeliveryCreationPort } from '@/modules/notification/application/port/driven/for-storing-deliveries/delivery-creation.port';
import { DispatchQueuePort } from '@/modules/notification/application/port/driven/for-storing-deliveries/dispatch-queue.port';
import { LeaseRecoveryQueuePort } from '@/modules/notification/application/port/driven/for-storing-deliveries/lease-recovery-queue.port';
import { ReconcileQueuePort } from '@/modules/notification/application/port/driven/for-storing-deliveries/reconcile-queue.port';
import { DeliveryCancellationPort } from '@/modules/notification/application/port/driven/for-storing-deliveries/delivery-cancellation.port';
import { DeliveryProgressPort } from '@/modules/notification/application/port/driven/for-storing-deliveries/delivery-progress.port';
import { ExpansionJobRepositoryPort } from '@/modules/notification/application/port/driven/for-storing-expansion-jobs/expansion-job-repository.port';
import { ExpansionQueuePort } from '@/modules/notification/application/port/driven/for-storing-expansion-jobs/expansion-queue.port';

export interface TransactionRepositories {
  readonly alarmRepository: AlarmRepositoryPort;
  readonly deliveryCreation: DeliveryCreationPort;
  readonly dispatchQueue: DispatchQueuePort;
  readonly leaseRecoveryQueue: LeaseRecoveryQueuePort;
  readonly reconcileQueue: ReconcileQueuePort;
  readonly deliveryCancellation: DeliveryCancellationPort;
  readonly deliveryProgress: DeliveryProgressPort;
  readonly expansionJobRepository: ExpansionJobRepositoryPort;
  readonly expansionQueue: ExpansionQueuePort;
}

export type TransactionWork<TResult> = (repositories: TransactionRepositories) => Promise<TResult>;

export interface SnapshotRepositories {
  readonly alarmReader: AlarmReaderPort;
  readonly deliveryProgress: DeliveryProgressPort;
}

export type SnapshotWork<TResult> = (repositories: SnapshotRepositories) => Promise<TResult>;
