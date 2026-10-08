import { AlarmReaderPort } from '@/modules/notification/application/port/out/alarm-reader.port';
import { AlarmRepositoryPort } from '@/modules/notification/application/port/out/alarm-repository.port';
import { DeliveryCreationPort } from '@/modules/notification/application/port/out/delivery-creation.port';
import { DispatchQueuePort } from '@/modules/notification/application/port/out/dispatch-queue.port';
import { LeaseRecoveryQueuePort } from '@/modules/notification/application/port/out/lease-recovery-queue.port';
import { ReconcileQueuePort } from '@/modules/notification/application/port/out/reconcile-queue.port';
import { DeliveryCancellationPort } from '@/modules/notification/application/port/out/delivery-cancellation.port';
import { DeliveryProgressPort } from '@/modules/notification/application/port/out/delivery-progress.port';
import { ExpansionJobRepositoryPort } from '@/modules/notification/application/port/out/expansion-job-repository.port';
import { ExpansionQueuePort } from '@/modules/notification/application/port/out/expansion-queue.port';

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
