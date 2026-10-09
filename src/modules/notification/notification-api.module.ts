import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { ClockPort } from '@/modules/notification/application/port/driven/for-telling-time/clock.port';
import { AlarmIdGeneratorPort } from '@/modules/notification/application/port/driven/for-generating-ids/alarm-id-generator.port';
import { DeliveryIdGeneratorPort } from '@/modules/notification/application/port/driven/for-generating-ids/delivery-id-generator.port';
import { TransactionPort } from '@/modules/notification/application/port/driven/for-running-transactions/transaction.port';
import { CancelAlarmUseCase } from '@/modules/notification/application/port/driving/for-managing-alarms/cancel-alarm.use-case';
import { CreateAlarmUseCase } from '@/modules/notification/application/port/driving/for-managing-alarms/create-alarm.use-case';
import { GetAlarmUseCase } from '@/modules/notification/application/port/driving/for-managing-alarms/get-alarm.use-case';
import { ListAlarmsUseCase } from '@/modules/notification/application/port/driving/for-managing-alarms/list-alarms.use-case';
import { StartDispatchUseCase } from '@/modules/notification/application/port/driving/for-managing-alarms/start-dispatch.use-case';
import { CancelAlarmService } from '@/modules/notification/application/service/alarm/cancel-alarm.service';
import { CreateAlarmService } from '@/modules/notification/application/service/alarm/create-alarm.service';
import { GetAlarmService } from '@/modules/notification/application/service/alarm/get-alarm.service';
import { ListAlarmsService } from '@/modules/notification/application/service/alarm/list-alarms.service';
import { StartDispatchService } from '@/modules/notification/application/service/alarm/start-dispatch.service';
import { DrizzleTransactionAdapter } from '@/modules/notification/adapter/driven/persistence/drizzle-transaction.adapter';
import { RandomIdGeneratorAdapter } from '@/modules/notification/adapter/driven/system/random-id-generator.adapter';
import { SystemClockAdapter } from '@/modules/notification/adapter/driven/system/system-clock.adapter';
import { NotificationDatabaseFactory } from '@/modules/notification/adapter/driven/persistence/notification-database.factory';
import { AlarmController } from '@/modules/notification/adapter/driving/web/alarm.controller';

@Module({
  controllers: [AlarmController],
  providers: [
    { provide: ClockPort, useClass: SystemClockAdapter },
    RandomIdGeneratorAdapter,
    { provide: AlarmIdGeneratorPort, useExisting: RandomIdGeneratorAdapter },
    { provide: DeliveryIdGeneratorPort, useExisting: RandomIdGeneratorAdapter },
    {
      provide: TransactionPort,
      inject: [Pool],
      useFactory: (pool: Pool): TransactionPort =>
        new DrizzleTransactionAdapter(NotificationDatabaseFactory.create(pool)),
    },
    {
      provide: CreateAlarmUseCase,
      inject: [TransactionPort, AlarmIdGeneratorPort, ClockPort],
      useFactory: (
        transaction: TransactionPort,
        alarmIdGenerator: AlarmIdGeneratorPort,
        clock: ClockPort,
      ): CreateAlarmUseCase => new CreateAlarmService(transaction, alarmIdGenerator, clock),
    },
    {
      provide: GetAlarmUseCase,
      inject: [TransactionPort],
      useFactory: (transaction: TransactionPort): GetAlarmUseCase =>
        new GetAlarmService(transaction),
    },
    {
      provide: ListAlarmsUseCase,
      inject: [TransactionPort],
      useFactory: (transaction: TransactionPort): ListAlarmsUseCase =>
        new ListAlarmsService(transaction),
    },
    {
      provide: StartDispatchUseCase,
      inject: [TransactionPort, DeliveryIdGeneratorPort, ClockPort],
      useFactory: (
        transaction: TransactionPort,
        deliveryIdGenerator: DeliveryIdGeneratorPort,
        clock: ClockPort,
      ): StartDispatchUseCase => new StartDispatchService(transaction, deliveryIdGenerator, clock),
    },
    {
      provide: CancelAlarmUseCase,
      inject: [TransactionPort, ClockPort],
      useFactory: (transaction: TransactionPort, clock: ClockPort): CancelAlarmUseCase =>
        new CancelAlarmService(transaction, clock),
    },
  ],
})
export class NotificationApiModule {}
