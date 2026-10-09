import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmCreation } from '@/modules/notification/domain/alarm/alarm.type';
import { ClockPort } from '@/modules/notification/application/port/driven/for-telling-time/clock.port';
import { AlarmIdGeneratorPort } from '@/modules/notification/application/port/driven/for-generating-ids/alarm-id-generator.port';
import { TransactionPort } from '@/modules/notification/application/port/driven/for-running-transactions/transaction.port';
import {
  CreateAlarmCommand,
  CreateAlarmResult,
} from '@/modules/notification/application/port/driving/for-managing-alarms/create-alarm.type';
import { CreateAlarmUseCase } from '@/modules/notification/application/port/driving/for-managing-alarms/create-alarm.use-case';
import { AlarmViewMapper } from '@/modules/notification/application/service/alarm/view/alarm-view.mapper';
import { AlarmRepositoryPort } from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.port';

interface CreateAlarmRepositories {
  readonly alarmRepository: Pick<AlarmRepositoryPort, 'save'>;
}

export class CreateAlarmService implements CreateAlarmUseCase {
  constructor(
    private readonly transaction: TransactionPort,
    private readonly alarmIdGenerator: AlarmIdGeneratorPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(command: Readonly<CreateAlarmCommand>): Promise<CreateAlarmResult> {
    const creation: AlarmCreation = Alarm.create(
      this.alarmIdGenerator.alarmId(),
      command,
      this.clock.now(),
    );
    if (creation.kind === 'rejected') {
      return { kind: 'rejected', error: creation.error };
    }
    await this.transaction.run(({ alarmRepository }: CreateAlarmRepositories): Promise<void> =>
      alarmRepository.save(creation.alarm),
    );
    return { kind: 'created', alarm: AlarmViewMapper.toView(creation.alarm) };
  }
}
