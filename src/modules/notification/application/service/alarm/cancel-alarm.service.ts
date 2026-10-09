import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { AlarmTransition, AlarmTransitioned } from '@/modules/notification/domain/alarm/alarm.type';
import { AlarmLookup } from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.type';
import { ClockPort } from '@/modules/notification/application/port/driven/for-telling-time/clock.port';
import { TransactionPort } from '@/modules/notification/application/port/driven/for-running-transactions/transaction.port';
import { AlarmCommand } from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-command.type';
import { CancelAlarmResult } from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-result.type';
import { CancelAlarmUseCase } from '@/modules/notification/application/port/driving/for-managing-alarms/cancel-alarm.use-case';
import { AlarmViewMapper } from '@/modules/notification/application/service/alarm/view/alarm-view.mapper';
import { AlarmRepositoryPort } from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.port';
import { DeliveryRepositoryPort } from '@/modules/notification/application/port/driven/for-storing-deliveries/delivery-repository.port';

interface CancelAlarmRepositories {
  readonly alarmRepository: Pick<AlarmRepositoryPort, 'findByIdForUpdate' | 'save'>;
  readonly deliveryRepository: Pick<DeliveryRepositoryPort, 'cancelWaiting'>;
}

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
        deliveryRepository,
      }: CancelAlarmRepositories): Promise<CancelAlarmResult> => {
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
        await deliveryRepository.cancelWaiting(alarmId, now);
        return { kind: 'cancelled', alarm: AlarmViewMapper.toView(alarm) };
      },
    );
  }
}
