import { Injectable } from '@nestjs/common';
import { PgTransactionConfig } from 'drizzle-orm/pg-core';
import { TransactionPort } from '@/modules/notification/application/port/out/transaction.port';
import {
  SnapshotWork,
  TransactionRepositories,
  TransactionWork,
} from '@/modules/notification/application/port/out/transaction.type';
import { DrizzleAlarmRepositoryAdapter } from '@/modules/notification/adapter/out/persistence/drizzle-alarm-repository.adapter';
import { DrizzleDeliveryRepositoryAdapter } from '@/modules/notification/adapter/out/persistence/drizzle-delivery-repository.adapter';
import { DrizzleExpansionJobRepositoryAdapter } from '@/modules/notification/adapter/out/persistence/drizzle-expansion-job-repository.adapter';
import { NotificationDatabase } from '@/modules/notification/adapter/out/persistence/notification-database.type';

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
    return {
      alarmRepository: new DrizzleAlarmRepositoryAdapter(transaction),
      deliveryCreation: deliveryRepository,
      dispatchQueue: deliveryRepository,
      leaseRecoveryQueue: deliveryRepository,
      reconcileQueue: deliveryRepository,
      deliveryCancellation: deliveryRepository,
      deliveryProgress: deliveryRepository,
      expansionJobRepository: new DrizzleExpansionJobRepositoryAdapter(transaction),
    };
  }
}
