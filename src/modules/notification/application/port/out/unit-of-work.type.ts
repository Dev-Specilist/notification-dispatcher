import { AlarmRepositoryPort } from '@/modules/notification/application/port/out/alarm-repository.port';
import { DeliveryRepositoryPort } from '@/modules/notification/application/port/out/delivery-repository.port';
import { ExpansionJobRepositoryPort } from '@/modules/notification/application/port/out/expansion-job-repository.port';

export interface TransactionRepositories {
  readonly alarmRepository: AlarmRepositoryPort;
  readonly deliveryRepository: DeliveryRepositoryPort;
  readonly expansionJobRepository: ExpansionJobRepositoryPort;
}

export type TransactionWork<TResult> = (repositories: TransactionRepositories) => Promise<TResult>;
