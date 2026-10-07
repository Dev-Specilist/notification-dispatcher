import { Injectable } from '@nestjs/common';
import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { AlarmLookup } from '@/modules/notification/application/port/alarm-repository.type';
import { UnitOfWorkPort } from '@/modules/notification/application/port/unit-of-work.port';
import { TransactionRepositories } from '@/modules/notification/application/port/unit-of-work.type';
import { AlarmResult } from '@/modules/notification/application/use-case/alarm-result.type';

@Injectable()
export class GetAlarmQuery {
  constructor(private readonly unitOfWork: UnitOfWorkPort) {}

  async execute(alarmId: AlarmId): Promise<AlarmResult> {
    const lookup: AlarmLookup = await this.unitOfWork.run(
      ({ alarmRepository }: TransactionRepositories): Promise<AlarmLookup> =>
        alarmRepository.findById(alarmId),
    );
    if (lookup.kind === 'missing') {
      return { kind: 'not-found', error: { code: 'ALARM_NOT_FOUND', alarmId } };
    }
    return lookup;
  }
}
