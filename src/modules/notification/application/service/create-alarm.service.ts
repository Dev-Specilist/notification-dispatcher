import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmCreation } from '@/modules/notification/domain/alarm/alarm.type';
import { ClockPort } from '@/modules/notification/application/port/out/clock.port';
import { IdGeneratorPort } from '@/modules/notification/application/port/out/id-generator.port';
import { UnitOfWorkPort } from '@/modules/notification/application/port/out/unit-of-work.port';
import { TransactionRepositories } from '@/modules/notification/application/port/out/unit-of-work.type';
import {
  CreateAlarmCommand,
  CreateAlarmResult,
} from '@/modules/notification/application/port/in/create-alarm.type';
import { CreateAlarmUseCase } from '@/modules/notification/application/port/in/create-alarm.use-case';
import { AlarmViewMapper } from '@/modules/notification/application/service/alarm-view.mapper';

export class CreateAlarmService implements CreateAlarmUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly idGenerator: IdGeneratorPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(command: Readonly<CreateAlarmCommand>): Promise<CreateAlarmResult> {
    const creation: AlarmCreation = Alarm.create(
      this.idGenerator.alarmId(),
      command,
      this.clock.now(),
    );
    if (creation.kind === 'rejected') {
      return { kind: 'rejected', error: creation.error };
    }
    await this.unitOfWork.run(({ alarmRepository }: TransactionRepositories): Promise<void> =>
      alarmRepository.save(creation.alarm),
    );
    return { kind: 'created', alarm: AlarmViewMapper.toView(creation.alarm) };
  }
}
