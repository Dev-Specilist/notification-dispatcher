import { Injectable } from '@nestjs/common';
import { PgTransactionConfig } from 'drizzle-orm/pg-core';
import { TransactionPort } from '@/modules/notification/application/port/driven/for-running-transactions/transaction.port';
import {
  SnapshotWork,
  TransactionRepositories,
  TransactionWork,
} from '@/modules/notification/application/port/driven/for-running-transactions/transaction.type';
import { DrizzleAlarmRepositoryAdapter } from '@/modules/notification/adapter/driven/persistence/alarm/drizzle-alarm-repository.adapter';
import { DrizzleDeliveryRepositoryAdapter } from '@/modules/notification/adapter/driven/persistence/delivery/drizzle-delivery-repository.adapter';
import { DrizzleExpansionJobRepositoryAdapter } from '@/modules/notification/adapter/driven/persistence/expansion-job/drizzle-expansion-job-repository.adapter';
import { NotificationDatabase } from '@/modules/notification/adapter/driven/persistence/notification-database.type';

@Injectable()
export class DrizzleTransactionAdapter implements TransactionPort {
  private static readonly SNAPSHOT_TRANSACTION_CONFIG: PgTransactionConfig = {
    isolationLevel: 'repeatable read',
    accessMode: 'read only',
  };

  constructor(private readonly database: NotificationDatabase) {}

  run<TResult>(work: TransactionWork<TResult>): Promise<TResult> {
    return this.database.transaction((transaction: NotificationDatabase): Promise<TResult> =>
      work(DrizzleTransactionAdapter.repositoriesOf(transaction)),
    );
  }

  readSnapshot<TResult>(work: SnapshotWork<TResult>): Promise<TResult> {
    return this.database.transaction(
      (transaction: NotificationDatabase): Promise<TResult> =>
        work({
          alarmReader: new DrizzleAlarmRepositoryAdapter(transaction),
          deliveryProgress: new DrizzleDeliveryRepositoryAdapter(transaction),
        }),
      DrizzleTransactionAdapter.SNAPSHOT_TRANSACTION_CONFIG,
    );
  }

  private static repositoriesOf(transaction: NotificationDatabase): TransactionRepositories {
    const deliveryRepository: DrizzleDeliveryRepositoryAdapter =
      new DrizzleDeliveryRepositoryAdapter(transaction);
    const expansionJobRepository: DrizzleExpansionJobRepositoryAdapter =
      new DrizzleExpansionJobRepositoryAdapter(transaction);
    return {
      alarmRepository: new DrizzleAlarmRepositoryAdapter(transaction),
      deliveryCreation: deliveryRepository,
      dispatchQueue: deliveryRepository,
      leaseRecoveryQueue: deliveryRepository,
      reconcileQueue: deliveryRepository,
      deliveryCancellation: deliveryRepository,
      deliveryProgress: deliveryRepository,
      expansionJobRepository,
      expansionQueue: expansionJobRepository,
    };
  }
}
