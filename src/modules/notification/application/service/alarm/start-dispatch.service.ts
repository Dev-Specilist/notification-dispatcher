import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import {
  AlarmSnapshot,
  AlarmTransition,
  AlarmTransitioned,
  RecipientId,
} from '@/modules/notification/domain/alarm/alarm.type';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import { AlarmLookup } from '@/modules/notification/application/port/out/alarm-repository.type';
import { ClockPort } from '@/modules/notification/application/port/out/clock.port';
import { DeliveryIdGeneratorPort } from '@/modules/notification/application/port/out/delivery-id-generator.port';
import { TransactionPort } from '@/modules/notification/application/port/out/transaction.port';
import { TransactionRepositories } from '@/modules/notification/application/port/out/transaction.type';
import { AlarmCommand } from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-command.type';
import { StartDispatchResult } from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-result.type';
import { StartDispatchUseCase } from '@/modules/notification/application/port/driving/for-managing-alarms/start-dispatch.use-case';
import { AlarmViewMapper } from '@/modules/notification/application/service/alarm/view/alarm-view.mapper';

export class StartDispatchService implements StartDispatchUseCase {
  constructor(
    private readonly transaction: TransactionPort,
    private readonly deliveryIdGenerator: DeliveryIdGeneratorPort,
    private readonly clock: ClockPort,
  ) {}

  execute({ alarmId }: Readonly<AlarmCommand>): Promise<StartDispatchResult> {
    if (!AlarmPredicates.isAlarmId(alarmId)) {
      return Promise.resolve({ kind: 'not-found', error: { code: 'ALARM_NOT_FOUND', alarmId } });
    }
    const now: Date = this.clock.now();
    return this.transaction.run(
      async ({
        alarmRepository,
        deliveryCreation,
        expansionJobRepository,
      }: TransactionRepositories): Promise<StartDispatchResult> => {
        const lookup: AlarmLookup = await alarmRepository.findByIdForUpdate(alarmId);
        if (lookup.kind === 'missing') {
          return { kind: 'not-found', error: { code: 'ALARM_NOT_FOUND', alarmId } };
        }
        const transition: AlarmTransition = lookup.alarm.startDispatch(now);
        if (transition.kind === 'conflict') {
          return transition;
        }
        const { alarm }: AlarmTransitioned = transition;
        await alarmRepository.save(alarm);
        const snapshot: AlarmSnapshot = alarm.snapshot();
        if (snapshot.kind === 'URGENT') {
          await deliveryCreation.saveAll(
            snapshot.target.recipientIds.map((recipientId: RecipientId): Delivery =>
              Delivery.create(
                {
                  id: this.deliveryIdGenerator.deliveryId(),
                  alarmId,
                  recipientId,
                  priority: 'URGENT',
                },
                now,
              ),
            ),
          );
        } else {
          await expansionJobRepository.enqueue(alarmId, now);
        }
        return { kind: 'dispatched', alarm: AlarmViewMapper.toView(alarm) };
      },
    );
  }
}
