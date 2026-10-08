import { Injectable } from '@nestjs/common';
import { TransactionPort } from '@/modules/notification/application/port/out/transaction.port';
import { TransactionWork } from '@/modules/notification/application/port/out/transaction.type';
import { DrizzleAlarmRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/drizzle-alarm-repository.adapter';
import { DrizzleDeliveryRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/drizzle-delivery-repository.adapter';
import { DrizzleExpansionJobRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/drizzle-expansion-job-repository.adapter';
import { NotificationDatabase } from '@/modules/notification/infrastructure/persistence/notification-database.type';

@Injectable()
export class DrizzleTransactionAdapter implements TransactionPort {
  constructor(private readonly database: NotificationDatabase) {}

  run<TResult>(work: TransactionWork<TResult>): Promise<TResult> {
    return this.database.transaction((transaction: NotificationDatabase): Promise<TResult> =>
      work({
        alarmRepository: new DrizzleAlarmRepositoryAdapter(transaction),
        deliveryRepository: new DrizzleDeliveryRepositoryAdapter(transaction),
        expansionJobRepository: new DrizzleExpansionJobRepositoryAdapter(transaction),
      }),
    );
  }
}
