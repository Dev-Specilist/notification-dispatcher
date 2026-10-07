import { Injectable } from '@nestjs/common';
import {
  AlarmId,
  AlarmTransition,
  AlarmTransitioned,
} from '@/modules/notification/domain/alarm/alarm.type';
import { AlarmLookup } from '@/modules/notification/application/port/alarm-repository.type';
import { ClockPort } from '@/modules/notification/application/port/clock.port';
import { UnitOfWorkPort } from '@/modules/notification/application/port/unit-of-work.port';
import { TransactionRepositories } from '@/modules/notification/application/port/unit-of-work.type';
import { CancelAlarmResult } from '@/modules/notification/application/use-case/alarm-result.type';

@Injectable()
export class CancelAlarmUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly clock: ClockPort,
  ) {}

  execute(alarmId: AlarmId): Promise<CancelAlarmResult> {
    const now: Date = this.clock.now();
    return this.unitOfWork.run(
      async ({
        alarmRepository,
        deliveryRepository,
      }: TransactionRepositories): Promise<CancelAlarmResult> => {
        const lookup: AlarmLookup = await alarmRepository.findById(alarmId);
        if (lookup.kind === 'missing') {
          return { kind: 'not-found', error: { code: 'ALARM_NOT_FOUND', alarmId } };
        }
        const transition: AlarmTransition = lookup.alarm.cancel(now);
        if (transition.kind === 'conflict') {
          return transition;
        }
        const { alarm }: AlarmTransitioned = transition;
        await alarmRepository.save(alarm);
        await deliveryRepository.cancelWaiting(alarmId, now);
        return { kind: 'cancelled', alarm };
      },
    );
  }
}
