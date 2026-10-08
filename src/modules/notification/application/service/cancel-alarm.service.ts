import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { AlarmTransition, AlarmTransitioned } from '@/modules/notification/domain/alarm/alarm.type';
import { AlarmLookup } from '@/modules/notification/application/port/out/alarm-repository.type';
import { ClockPort } from '@/modules/notification/application/port/out/clock.port';
import { TransactionPort } from '@/modules/notification/application/port/out/transaction.port';
import { TransactionRepositories } from '@/modules/notification/application/port/out/transaction.type';
import { AlarmCommand } from '@/modules/notification/application/port/in/alarm-command.type';
import { CancelAlarmResult } from '@/modules/notification/application/port/in/alarm-result.type';
import { CancelAlarmUseCase } from '@/modules/notification/application/port/in/cancel-alarm.use-case';
import { AlarmViewMapper } from '@/modules/notification/application/service/alarm-view.mapper';

export class CancelAlarmService implements CancelAlarmUseCase {
  constructor(
    private readonly transaction: TransactionPort,
    private readonly clock: ClockPort,
  ) {}

  execute({ alarmId }: Readonly<AlarmCommand>): Promise<CancelAlarmResult> {
    if (!AlarmPredicates.isAlarmId(alarmId)) {
      return Promise.resolve({ kind: 'not-found', error: { code: 'ALARM_NOT_FOUND', alarmId } });
    }
    const now: Date = this.clock.now();
    return this.transaction.run(
      async ({
        alarmRepository,
        deliveryCancellation,
      }: TransactionRepositories): Promise<CancelAlarmResult> => {
        const lookup: AlarmLookup = await alarmRepository.findByIdForUpdate(alarmId);
        if (lookup.kind === 'missing') {
          return { kind: 'not-found', error: { code: 'ALARM_NOT_FOUND', alarmId } };
        }
        const transition: AlarmTransition = lookup.alarm.cancel(now);
        if (transition.kind === 'conflict') {
          return transition;
        }
        const { alarm }: AlarmTransitioned = transition;
        await alarmRepository.save(alarm);
        await deliveryCancellation.cancelWaiting(alarmId, now);
        return { kind: 'cancelled', alarm: AlarmViewMapper.toView(alarm) };
      },
    );
  }
}
