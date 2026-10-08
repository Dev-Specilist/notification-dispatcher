import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { ClockPort } from '@/modules/notification/application/port/out/clock.port';
import { IdGeneratorPort } from '@/modules/notification/application/port/out/id-generator.port';
import { UnitOfWorkPort } from '@/modules/notification/application/port/out/unit-of-work.port';
import { CreateAlarmUseCase } from '@/modules/notification/application/port/in/create-alarm.use-case';
import { CreateAlarmService } from '@/modules/notification/application/service/create-alarm.service';
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
    {
      provide: CreateAlarmUseCase,
      inject: [UnitOfWorkPort, IdGeneratorPort, ClockPort],
      useFactory: (
        unitOfWork: UnitOfWorkPort,
        idGenerator: IdGeneratorPort,
        clock: ClockPort,
      ): CreateAlarmUseCase => new CreateAlarmService(unitOfWork, idGenerator, clock),
    },
  ],
})
export class NotificationApiModule {}
