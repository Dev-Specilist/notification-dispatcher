import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { ClockPort } from '@/modules/notification/application/port/out/clock.port';
import { AlarmIdGeneratorPort } from '@/modules/notification/application/port/out/alarm-id-generator.port';
import { TransactionPort } from '@/modules/notification/application/port/out/transaction.port';
import { CreateAlarmUseCase } from '@/modules/notification/application/port/in/create-alarm.use-case';
import { CreateAlarmService } from '@/modules/notification/application/service/create-alarm.service';
import { DrizzleTransactionAdapter } from '@/modules/notification/adapter/out/persistence/drizzle-transaction.adapter';
import { RandomIdGeneratorAdapter } from '@/modules/notification/adapter/out/system/random-id-generator.adapter';
import { SystemClockAdapter } from '@/modules/notification/adapter/out/system/system-clock.adapter';
import { NotificationDatabaseFactory } from '@/modules/notification/adapter/out/persistence/notification-database.factory';
import { AlarmController } from '@/modules/notification/adapter/in/web/alarm.controller';

@Module({
  controllers: [AlarmController],
  providers: [
    { provide: ClockPort, useClass: SystemClockAdapter },
    { provide: AlarmIdGeneratorPort, useClass: RandomIdGeneratorAdapter },
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
  ],
})
export class NotificationApiModule {}
