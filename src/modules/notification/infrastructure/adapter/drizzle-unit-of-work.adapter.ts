import { Injectable } from '@nestjs/common';
import { UnitOfWorkPort } from '@/modules/notification/application/port/unit-of-work.port';
import { TransactionWork } from '@/modules/notification/application/port/unit-of-work.type';
import { DrizzleAlarmRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/drizzle-alarm-repository.adapter';
import { DrizzleDeliveryRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/drizzle-delivery-repository.adapter';
import { DrizzleExpansionJobRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/drizzle-expansion-job-repository.adapter';
import { NotificationDatabase } from '@/modules/notification/infrastructure/persistence/notification-database.type';

@Injectable()
export class DrizzleUnitOfWorkAdapter implements UnitOfWorkPort {
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
