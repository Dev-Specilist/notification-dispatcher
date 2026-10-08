import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { ClockPort } from '@/modules/notification/application/port/clock.port';
import { IdGeneratorPort } from '@/modules/notification/application/port/id-generator.port';
import { UnitOfWorkPort } from '@/modules/notification/application/port/unit-of-work.port';
import { CreateAlarmUseCase } from '@/modules/notification/application/use-case/create-alarm.use-case';
import { DrizzleUnitOfWorkAdapter } from '@/modules/notification/infrastructure/adapter/drizzle-unit-of-work.adapter';
import { RandomIdGeneratorAdapter } from '@/modules/notification/infrastructure/adapter/random-id-generator.adapter';
import { SystemClockAdapter } from '@/modules/notification/infrastructure/adapter/system-clock.adapter';
import { NotificationDatabaseFactory } from '@/modules/notification/infrastructure/persistence/notification-database.factory';
import { AlarmController } from '@/modules/notification/presentation/alarm.controller';

@Module({
  controllers: [AlarmController],
  providers: [
    { provide: ClockPort, useClass: SystemClockAdapter },
    { provide: IdGeneratorPort, useClass: RandomIdGeneratorAdapter },
    {
      provide: UnitOfWorkPort,
      inject: [Pool],
      useFactory: (pool: Pool): UnitOfWorkPort =>
        new DrizzleUnitOfWorkAdapter(NotificationDatabaseFactory.create(pool)),
    },
    CreateAlarmUseCase,
  ],
})
export class NotificationApiModule {}
