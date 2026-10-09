import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import {
  AlarmSnapshot,
  AlarmTransition,
  AlarmTransitioned,
  RecipientId,
} from '@/modules/notification/domain/alarm/alarm.type';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import { AlarmLookup } from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.type';
import { ClockPort } from '@/modules/notification/application/port/driven/for-telling-time/clock.port';
import { DeliveryIdGeneratorPort } from '@/modules/notification/application/port/driven/for-generating-ids/delivery-id-generator.port';
import { TransactionPort } from '@/modules/notification/application/port/driven/for-running-transactions/transaction.port';
import {
  StartDispatchCommand,
  StartDispatchResult,
} from '@/modules/notification/application/port/driving/for-managing-alarms/start-dispatch.type';
import { StartDispatchUseCase } from '@/modules/notification/application/port/driving/for-managing-alarms/start-dispatch.use-case';
import { AlarmViewMapper } from '@/modules/notification/application/service/alarm/view/alarm-view.mapper';
import { AlarmRepositoryPort } from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.port';
import { DeliveryRepositoryPort } from '@/modules/notification/application/port/driven/for-storing-deliveries/delivery-repository.port';
import { ExpansionJobRepositoryPort } from '@/modules/notification/application/port/driven/for-storing-expansion-jobs/expansion-job-repository.port';

interface StartDispatchRepositories {
  readonly alarmRepository: Pick<AlarmRepositoryPort, 'findByIdForUpdate' | 'save'>;
  readonly deliveryRepository: Pick<DeliveryRepositoryPort, 'saveAll'>;
  readonly expansionJobRepository: Pick<ExpansionJobRepositoryPort, 'enqueue'>;
}

export class StartDispatchService implements StartDispatchUseCase {
  constructor(
    private readonly transaction: TransactionPort,
    private readonly deliveryIdGenerator: DeliveryIdGeneratorPort,
    private readonly clock: ClockPort,
  ) {}

  execute({ alarmId }: Readonly<StartDispatchCommand>): Promise<StartDispatchResult> {
    if (!AlarmPredicates.isAlarmId(alarmId)) {
      return Promise.resolve({ kind: 'not-found', error: { code: 'ALARM_NOT_FOUND', alarmId } });
    }
    const now: Date = this.clock.now();
    return this.transaction.run(
      async ({
        alarmRepository,
        deliveryRepository,
        expansionJobRepository,
      }: StartDispatchRepositories): Promise<StartDispatchResult> => {
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
          await deliveryRepository.saveAll(
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
