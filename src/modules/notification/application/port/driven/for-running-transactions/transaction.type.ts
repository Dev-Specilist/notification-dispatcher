import { AlarmRepositoryPort } from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.port';
import { DeliveryRepositoryPort } from '@/modules/notification/application/port/driven/for-storing-deliveries/delivery-repository.port';
import { ExpansionJobRepositoryPort } from '@/modules/notification/application/port/driven/for-storing-expansion-jobs/expansion-job-repository.port';

export interface TransactionRepositories {
  readonly alarmRepository: AlarmRepositoryPort;
  readonly deliveryRepository: DeliveryRepositoryPort;
  readonly expansionJobRepository: ExpansionJobRepositoryPort;
}

export type TransactionWork<TResult> = (repositories: TransactionRepositories) => Promise<TResult>;

export type AlarmReader = Pick<AlarmRepositoryPort, 'findById' | 'findPage'>;

export type DeliveryProgressReader = Pick<
  DeliveryRepositoryPort,
  'countUnsettled' | 'countByStatus'
>;

export interface SnapshotRepositories {
  readonly alarmRepository: AlarmReader;
  readonly deliveryRepository: DeliveryProgressReader;
}

export type SnapshotWork<TResult> = (repositories: SnapshotRepositories) => Promise<TResult>;
