import { Injectable } from '@nestjs/common';
import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmCreation, AlarmDraft } from '@/modules/notification/domain/alarm/alarm.type';
import { ClockPort } from '@/modules/notification/application/port/clock.port';
import { IdGeneratorPort } from '@/modules/notification/application/port/id-generator.port';
import { UnitOfWorkPort } from '@/modules/notification/application/port/unit-of-work.port';
import { TransactionRepositories } from '@/modules/notification/application/port/unit-of-work.type';

@Injectable()
export class CreateAlarmUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly idGenerator: IdGeneratorPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(draft: Readonly<AlarmDraft>): Promise<AlarmCreation> {
    const creation: AlarmCreation = Alarm.create(
      this.idGenerator.alarmId(),
      draft,
      this.clock.now(),
    );
    if (creation.kind === 'rejected') {
      return creation;
    }
    await this.unitOfWork.run(({ alarmRepository }: TransactionRepositories): Promise<void> =>
      alarmRepository.save(creation.alarm),
    );
    return creation;
  }
}
