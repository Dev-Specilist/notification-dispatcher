import { Injectable } from '@nestjs/common';
import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { AlarmRepositoryPort } from '@/modules/notification/application/port/alarm-repository.port';
import { AlarmLookup } from '@/modules/notification/application/port/alarm-repository.type';
import { AlarmResult } from '@/modules/notification/application/use-case/alarm-result.type';

@Injectable()
export class GetAlarmQuery {
  constructor(private readonly alarmRepository: AlarmRepositoryPort) {}

  async execute(alarmId: AlarmId): Promise<AlarmResult> {
    const lookup: AlarmLookup = await this.alarmRepository.findById(alarmId);
    if (lookup.kind === 'missing') {
      return { kind: 'not-found', error: { code: 'ALARM_NOT_FOUND', alarmId } };
    }
    return lookup;
  }
}
