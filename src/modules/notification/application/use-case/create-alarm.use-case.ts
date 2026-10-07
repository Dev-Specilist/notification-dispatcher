import { Injectable } from '@nestjs/common';
import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmCreation, AlarmDraft } from '@/modules/notification/domain/alarm/alarm.type';
import { AlarmRepositoryPort } from '@/modules/notification/application/port/alarm-repository.port';
import { ClockPort } from '@/modules/notification/application/port/clock.port';
import { IdGeneratorPort } from '@/modules/notification/application/port/id-generator.port';

@Injectable()
export class CreateAlarmUseCase {
  constructor(
    private readonly alarmRepository: AlarmRepositoryPort,
    private readonly idGenerator: IdGeneratorPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(draft: Readonly<AlarmDraft>): Promise<AlarmCreation> {
    const creation: AlarmCreation = Alarm.create(
      this.idGenerator.alarmId(),
      draft,
      this.clock.now(),
    );
    if (creation.kind === 'created') {
      await this.alarmRepository.save(creation.alarm);
    }
    return creation;
  }
}
