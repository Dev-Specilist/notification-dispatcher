import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { ClockPort } from '@/modules/notification/application/port/out/clock.port';
import { AlarmIdGeneratorPort } from '@/modules/notification/application/port/out/alarm-id-generator.port';
import { TransactionPort } from '@/modules/notification/application/port/out/transaction.port';
import { CreateAlarmUseCase } from '@/modules/notification/application/port/in/create-alarm.use-case';
import { CreateAlarmService } from '@/modules/notification/application/service/create-alarm.service';
import { DrizzleTransactionAdapter } from '@/modules/notification/infrastructure/adapter/drizzle-transaction.adapter';
import { RandomIdGeneratorAdapter } from '@/modules/notification/infrastructure/adapter/random-id-generator.adapter';
import { SystemClockAdapter } from '@/modules/notification/infrastructure/adapter/system-clock.adapter';
import { NotificationDatabaseFactory } from '@/modules/notification/infrastructure/persistence/notification-database.factory';
import { AlarmController } from '@/modules/notification/presentation/alarm.controller';

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
