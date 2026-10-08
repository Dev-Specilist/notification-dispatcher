import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { AlarmLookup } from '@/modules/notification/application/port/out/alarm-repository.type';
import { TransactionPort } from '@/modules/notification/application/port/out/transaction.port';
import { TransactionRepositories } from '@/modules/notification/application/port/out/transaction.type';
import { AlarmResult } from '@/modules/notification/application/port/in/alarm-result.type';
import { GetAlarmUseCase } from '@/modules/notification/application/port/in/get-alarm.use-case';
import { AlarmViewMapper } from '@/modules/notification/application/service/alarm-view.mapper';

export class GetAlarmService implements GetAlarmUseCase {
  constructor(private readonly transaction: TransactionPort) {}

  async execute(alarmId: AlarmId): Promise<AlarmResult> {
    const lookup: AlarmLookup = await this.transaction.run(
      ({ alarmRepository }: TransactionRepositories): Promise<AlarmLookup> =>
        alarmRepository.findById(alarmId),
    );
    if (lookup.kind === 'missing') {
      return { kind: 'not-found', error: { code: 'ALARM_NOT_FOUND', alarmId } };
    }
    return { kind: 'found', alarm: AlarmViewMapper.toView(lookup.alarm) };
  }
}
